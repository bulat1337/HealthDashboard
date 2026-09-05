import asyncio
import importlib.util
import json
import pathlib
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('scale_bridge', pathlib.Path(__file__).parents[1] / 'scripts/xiaomi-s400-ble-bridge.py')
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)

class BridgeTests(unittest.IsolatedAsyncioTestCase):
    def config(self, **kwargs):
        return m.BridgeConfig(bindkey=b'0'*16, ingest_url='http://localhost', ingest_token='test', **kwargs)

    def test_decodes_only_fresh_fields_and_preserves_device_timestamp(self):
        high = m.decode_s400_object(struct.pack('<BII', 2, 650 | (30<<11) | (4700<<18), 123))
        low = m.decode_s400_object(struct.pack('<BII', 2, 4200<<18, 123))
        self.assertEqual(high['weight'],65)
        self.assertEqual(high['heartRate'],80)
        self.assertNotIn('weight',low)
        self.assertEqual(low['impedanceLow'],420)
        self.assertEqual(high['device_timestamp_raw'],123)
        self.assertEqual(m.decode_s400_object(b'bad'),{})

    async def test_real_parser_pairs_profiles_without_cumulative_sensor_leakage(self):
        from types import SimpleNamespace
        from xiaomi_ble.devices import DEVICE_TYPES
        device_id=next(k for k,v in DEVICE_TYPES.items() if v.model == "MJTZC01YM")
        b=m.XiaomiS400Bridge(self.config(settle_seconds=0))
        device=SimpleNamespace(address="AA:BB:CC:DD:EE:FF",name="scale")
        def emit(profile,data,stamp,counter):
            raw=struct.pack('<HHB',0x5040,device_id,counter)+struct.pack('<HB',0x6e16,9)+struct.pack('<BII',profile,data,stamp)
            advert=SimpleNamespace(local_name="scale",rssi=-60,manufacturer_data={},service_data={m.SERVICE_MIBEACON:raw},service_uuids=[m.SERVICE_MIBEACON])
            b.on_advertisement(device,advert)
        emit(1,650|(4700<<18),123,1)
        emit(2,490|(5800<<18),124,2)
        emit(2,5200<<18,124,3)
        await asyncio.sleep(.01)
        self.assertEqual(len(b.outbox),1)
        row=next(iter(b.outbox.values()))
        self.assertEqual((row['profile_id'],row['weight'],row['impedanceLow']),(2,49,520))
        emit(1,4200<<18,123,4)
        await asyncio.sleep(.01)
        self.assertEqual(len(b.outbox),2)

    async def test_failed_delivery_survives_restart_and_is_only_marked_on_ack(self):
        with tempfile.TemporaryDirectory() as d:
            c=self.config(state_file=str(pathlib.Path(d)/'state.json'), settle_seconds=0, retry_seconds=.001)
            b=m.XiaomiS400Bridge(c)
            p={'weight':65,'impedance':470,'impedanceLow':420,'profile_id':1}
            b.update_pending('one',p)
            await b.send_after_settle('one')
            self.assertEqual(len(b.outbox),1)
            async def cycle(ack):
                with patch.object(m,'post_payload',return_value=ack):
                    task=asyncio.create_task(b.deliver_outbox())
                    await asyncio.sleep(.03)
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError): await task
            await cycle(False)
            self.assertEqual(b.last_sent,{})
            b=m.XiaomiS400Bridge(c)
            self.assertEqual(len(b.outbox),1)
            await cycle(True)
            self.assertEqual(len(b.outbox),0)
            self.assertFalse(b.should_send(p))
            b=m.XiaomiS400Bridge(c)
            self.assertFalse(b.should_send(p))
            self.assertTrue(b.should_send({**p,'device_timestamp_raw':456}))

    def test_same_result_never_reappears_after_six_hours_and_profiles_are_separate(self):
        b=m.XiaomiS400Bridge(self.config())
        p={'weight':65,'impedance':470,'impedanceLow':420,'profile_id':1}
        self.assertTrue(b.should_send(p))
        b.last_sent[b.person_key(p)]=b.fingerprint(p)
        with patch.object(m.time,'monotonic',return_value=1e12): self.assertFalse(b.should_send(p))
        self.assertTrue(b.should_send({**p,'profile_id':2}))
        self.assertFalse(b.should_send({**p,'weight':float('nan')}))

if __name__=='__main__': unittest.main()
