# BrightData fixtures

Recorded from the live API on 2026-10-19. Nothing here is invented; where a file
is cut down, this says how.

| File | Source |
|------|--------|
| `snapshot-sd_mvfl47b4i0700m0pb.json` | `GET /datasets/v3/snapshot/sd_mvfl47b4i0700m0pb?format=json`, the 3-video verification run. **Field subset**: each row keeps only the fields the code reads plus `input`/`timestamp`; the rest (`video_url`, which carries proxy exit addresses, `comments`, recommendations, thumbnails, codec info) was dropped. Values are unchanged. |
| `error-row-sd_mvfm460c1mgwbewzgj.json` | The one error row (`dead_page`, "Video unavailable") from a 100-video snapshot of the bulk run, verbatim. |
| `progress-ready.json` | `GET /datasets/v3/progress/sd_mvfl47b4i0700m0pb` after it finished. |
| `progress-running.json` | `GET /datasets/v3/progress/<id>` for a snapshot still collecting. |
| `progress-404.txt` | Body of the 404 for a snapshot id that does not exist. |
| `progress-401.txt` | Body of the 401 for a wrong API key. |
| `scrape-202.json` | The 202 body from `POST /datasets/v3/scrape` (the synchronous endpoint) when the collection outlived the request. `/trigger` answers with the same `snapshot_id` field, which is the only field the code reads. |

Not yet observed live, so not recorded: a row that has a `video_id` but no
`formatted_transcript`. The test for that case takes a real row above and removes
its cues, and says so.

`../youtube-api/` holds two Data API v3 responses from the same day:
`playlistItems` for Kurt Benkert's uploads playlist (`maxResults=3`) and
`search` (`type=video`, `order=relevance`, `maxResults=3`) for
"Madden 27 how to beat the Bills".
