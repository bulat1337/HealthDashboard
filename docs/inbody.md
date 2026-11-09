# InBody measurements

Health → InBody shares the dashboard person selector and keeps an independent
measurement history. Values come from the device report; Xiaomi and Fitbit
records are unchanged. The first report appears as a single chart point.
Subsequent reports add dated points; missing optional values remain gaps.

Use **Добавить измерение** to enter a report. Date/time, device, weight,
skeletal muscle mass, body fat mass and body fat percentage are required.
Additional metrics and segment values are optional. Validation and save errors
keep the form filled. A person's report at the same minute is rejected as a
duplicate; other people can have a report at that minute.

## Storage

`INBODY_DATA_FILE` defaults to `data/inbody/inbody-data.json`. The version 1
document contains `measurements`, each with a generated `id`, `userId`,
`measuredAtLocal`, `device`, `metrics` and `createdAt`. Optional fields include
height, age and sex from that report, source reference ranges, segment values,
device assessments, impedance and notes. Missing or unreadable values are
omitted. Dates preserve the apparatus wall-clock time because printed reports
do not declare a time zone. Historical age and height belong to each report.

Data saves use the existing atomic writer. Keep the JSON file and original
images in ignored local or deployment storage. To migrate an installation,
copy the entire configured InBody directory, including `reports/`, and set
`INBODY_DATA_FILE` in that installation's environment. Personal reports are
never seed data in the public repository.

An imported record can reference an original JPEG, PNG or WebP by basename in
`sourceImage`. Store that original in `reports/` beside the JSON file. The
source route only serves a recorded image basename from that directory. The
manual form stores numeric data and notes; photo transcription and importing
an original are performed locally when the user supplies the report.

## API

- `GET /api/inbody-data`: `{ data: { schemaVersion: 1, measurements: [...] } }`.
- `POST /api/inbody-data/measurements`: validate an existing dashboard user and
  report fields, persist a new measurement, and return `{ record, data }`.
  The server assigns identity and creation time. Clients cannot set image paths.
- `GET /api/inbody-data/measurements/:id/source`: view a stored original.
- WebSocket `inbody-data-updated`: reload after saves or external file changes.

The API uses the dashboard's same-origin write check and existing access model.
Schema and labels are defined in `src/inbody-types.ts`; numeric reference ranges
and assessments are supplied by each source report. Visual colors carry series
identity and selection state.
