### Phase p50 / p95 (ms) per hook kind, policy and repo

| repo | policy | hook | n | total | stdin | policy_root | policy | cache_dir | walk | index_read | pool | classify | index_write | link | needs_full_scan | full_scan | check | state | output |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dub | accept-only | PostToolUse:non-source | 3 | 66.4 / 141.0 | 0.2 / 0.6 | 0.0 / 0.0 | 0.5 / 0.7 | 5.6 / 91.9 | 46.6 / 63.1 | – | – | – | – | – | 0.1 / 0.1 | – | 0.1 / 0.1 | 0.0 / 0.0 | 0.0 / 0.0 |
| dub | accept-only | PostToolUse:source | 45 | 74.6 / 172.4 | 0.0 / 0.4 | 0.0 / 0.0 | 0.4 / 0.7 | 3.4 / 10.0 | 35.2 / 95.2 | 2.4 / 14.4 | 0.3 / 8.5 | 4.6 / 19.5 | 4.3 / 14.7 | 5.7 / 22.4 | 0.5 / 0.6 | – | 0.3 / 0.4 | 0.0 / 0.0 | 0.0 / 0.0 |
| dub | accept-only | PreToolUse | 45 | 0.8 / 2.5 | 0.0 / 1.4 | 0.0 / 0.0 | 0.5 / 0.7 | – | – | – | – | – | – | – | – | – | – | – | 0.0 / 0.0 |
| dub | accept-only | SessionStart | 3 | 1211.3 / 1225.6 | 0.0 / 0.0 | 0.0 / 0.0 | 0.5 / 0.5 | 2.3 / 3.3 | – | – | – | – | – | – | – | 960.1 / 974.7 | 224.4 / 229.1 | 0.6 / 0.9 | 0.1 / 0.2 |
| dub | accept-only | Stop:scan | 6 | 1116.7 / 1305.1 | 0.0 / 0.2 | 0.0 / 0.0 | 0.5 / 0.7 | 4.4 / 9.3 | – | – | – | – | – | – | – | 868.9 / 1022.8 | 177.3 / 281.1 | 0.5 / 2.2 | 0.0 / 0.0 |
| dub | all | PostToolUse:non-source | 3 | 44.6 / 89.8 | 0.0 / 0.0 | 0.0 / 0.0 | 0.5 / 0.7 | 3.9 / 10.2 | 39.3 / 78.4 | – | – | – | – | – | 0.1 / 0.1 | – | 0.1 / 0.1 | 0.0 / 0.0 | 0.0 / 0.0 |
| dub | all | PostToolUse:source | 45 | 68.8 / 140.0 | 0.0 / 4.3 | 0.0 / 0.0 | 0.4 / 0.5 | 4.2 / 11.7 | 31.2 / 71.3 | 2.5 / 10.3 | 0.3 / 6.0 | 4.5 / 9.1 | 3.9 / 11.2 | 6.3 / 19.9 | 0.5 / 0.8 | – | 0.3 / 0.4 | 0.0 / 0.0 | 0.0 / 0.0 |
| dub | all | PreToolUse | 45 | 0.9 / 2.6 | 0.0 / 0.8 | 0.0 / 0.1 | 0.5 / 1.3 | – | – | – | – | – | – | – | – | – | – | – | 0.0 / 0.0 |
| dub | all | SessionStart | 3 | 1063.8 / 1082.2 | 0.0 / 0.1 | 0.0 / 0.0 | 0.5 / 0.5 | 4.0 / 5.0 | – | – | – | – | – | – | – | 845.4 / 853.4 | 208.3 / 211.2 | 0.3 / 0.3 | 0.0 / 0.1 |
| dub | all | Stop:no-scan | 6 | 0.7 / 3.5 | 0.0 / 0.0 | 0.0 / 0.0 | 0.4 / 0.7 | – | – | – | – | – | – | – | – | – | – | – | 0.0 / 0.0 |
| dub | all-block | PostToolUse:non-source | 3 | 49.8 / 61.7 | 0.0 / 0.0 | 0.0 / 0.0 | 0.5 / 0.5 | 2.6 / 18.6 | 46.3 / 57.9 | – | – | – | – | – | 0.1 / 0.1 | – | 0.1 / 0.1 | 0.0 / 0.0 | 0.0 / 0.0 |
| dub | all-block | PostToolUse:source | 45 | 75.4 / 147.6 | 0.0 / 2.8 | 0.0 / 0.0 | 0.4 / 0.5 | 3.4 / 30.0 | 33.7 / 86.6 | 2.4 / 9.8 | 0.3 / 3.8 | 4.4 / 20.2 | 4.9 / 18.4 | 5.8 / 23.2 | 0.5 / 0.6 | – | 0.3 / 0.3 | 0.0 / 0.0 | 0.0 / 0.0 |
| dub | all-block | PreToolUse | 45 | 0.8 / 5.5 | 0.0 / 4.7 | 0.0 / 0.0 | 0.5 / 0.7 | – | – | – | – | – | – | – | – | – | – | – | 0.0 / 0.0 |
| dub | all-block | SessionStart | 3 | 1310.0 / 1330.7 | 0.0 / 0.2 | 0.0 / 0.0 | 0.5 / 0.6 | 4.3 / 18.4 | – | – | – | – | – | – | – | 1001.6 / 1052.7 | 226.4 / 272.1 | 0.8 / 6.0 | 0.1 / 0.5 |
| dub | all-block | Stop:scan | 6 | 1237.0 / 1392.7 | 0.0 / 1.6 | 0.0 / 0.0 | 0.5 / 0.5 | 4.6 / 7.2 | – | – | – | – | – | – | – | 922.9 / 1080.5 | 264.8 / 288.4 | 0.9 / 6.6 | 0.0 / 0.0 |
| infisical | accept-only | PostToolUse:non-source | 3 | 231.4 / 329.2 | 0.0 / 0.2 | 0.0 / 0.0 | 0.5 / 0.6 | 8.4 / 17.3 | 223.2 / 318.5 | – | – | – | – | – | 0.1 / 0.1 | – | 0.2 / 0.2 | 0.0 / 0.0 | 0.0 / 0.0 |
| infisical | accept-only | PostToolUse:source | 48 | 358.7 / 501.9 | 0.0 / 6.7 | 0.0 / 0.0 | 0.5 / 0.7 | 5.3 / 27.3 | 176.8 / 268.7 | 8.4 / 95.0 | 0.3 / 7.7 | 11.6 / 46.0 | 22.5 / 79.6 | 72.3 / 113.9 | 1.1 / 5.6 | – | 0.4 / 4.8 | 0.0 / 0.1 | 0.0 / 0.0 |
| infisical | accept-only | PreToolUse | 48 | 1.0 / 5.0 | 0.0 / 2.9 | 0.0 / 0.1 | 0.6 / 0.8 | – | – | – | – | – | – | – | – | – | – | – | 0.0 / 0.0 |
| infisical | accept-only | SessionStart | 3 | 3875.8 / 4291.7 | 0.0 / 1.7 | 0.0 / 0.0 | 0.6 / 0.6 | 10.7 / 15.6 | – | – | – | – | – | – | – | 3033.8 / 3358.9 | 771.5 / 840.9 | 0.2 / 0.2 | 0.1 / 1.0 |
| infisical | accept-only | Stop:scan | 6 | 3897.2 / 4669.3 | 0.0 / 0.8 | 0.0 / 0.0 | 0.6 / 5.0 | 6.3 / 128.9 | – | – | – | – | – | – | – | 3001.2 / 3699.1 | 610.4 / 890.9 | 0.7 / 6.5 | 0.0 / 0.0 |
| infisical | all | PostToolUse:non-source | 3 | 90.1 / 101.2 | 0.0 / 0.0 | 0.0 / 0.0 | 0.5 / 0.6 | 4.2 / 4.6 | 73.5 / 95.3 | – | – | – | – | – | 0.1 / 0.1 | – | 0.2 / 0.3 | 0.0 / 0.0 | 0.0 / 0.0 |
| infisical | all | PostToolUse:source | 48 | 205.9 / 331.5 | 0.0 / 4.8 | 0.0 / 0.0 | 0.5 / 1.3 | 5.7 / 27.0 | 91.9 / 176.2 | 6.9 / 22.0 | 0.3 / 6.0 | 9.3 / 29.6 | 12.6 / 47.1 | 47.9 / 73.6 | 1.2 / 6.1 | – | 0.4 / 0.6 | 0.0 / 0.1 | 0.0 / 0.0 |
| infisical | all | PreToolUse | 48 | 0.9 / 3.0 | 0.0 / 0.4 | 0.0 / 0.1 | 0.5 / 2.5 | – | – | – | – | – | – | – | – | – | – | – | 0.0 / 0.0 |
| infisical | all | SessionStart | 3 | 2895.5 / 2956.3 | 0.0 / 0.5 | 0.0 / 0.0 | 0.6 / 0.7 | 6.9 / 12.6 | – | – | – | – | – | – | – | 2322.0 / 2327.0 | 501.8 / 556.9 | 0.3 / 4.5 | 0.0 / 0.0 |
| infisical | all | Stop:no-scan | 6 | 0.8 / 1.7 | 0.0 / 0.7 | 0.0 / 0.0 | 0.5 / 0.5 | – | – | – | – | – | – | – | – | – | – | – | 0.0 / 0.0 |
| infisical | all-block | PostToolUse:non-source | 3 | 178.9 / 365.3 | 2.5 / 6.4 | 0.0 / 0.0 | 0.6 / 4.6 | 15.7 / 15.8 | 156.9 / 349.4 | – | – | – | – | – | 0.1 / 0.1 | – | 0.2 / 0.2 | 0.0 / 0.0 | 0.0 / 0.0 |
| infisical | all-block | PostToolUse:source | 48 | 273.6 / 520.7 | 0.0 / 6.9 | 0.0 / 0.0 | 0.5 / 0.6 | 7.0 / 20.1 | 122.5 / 205.4 | 9.8 / 25.0 | 0.3 / 13.4 | 10.8 / 37.7 | 18.6 / 66.9 | 66.2 / 114.1 | 1.1 / 3.7 | – | 0.4 / 1.4 | 0.0 / 0.1 | 0.0 / 0.0 |
| infisical | all-block | PreToolUse | 48 | 0.9 / 4.2 | 0.0 / 2.4 | 0.0 / 0.0 | 0.5 / 0.9 | – | – | – | – | – | – | – | – | – | – | – | 0.0 / 0.0 |
| infisical | all-block | SessionStart | 3 | 3448.2 / 3693.3 | 0.0 / 0.2 | 0.0 / 0.0 | 0.6 / 18.7 | 4.0 / 23.9 | – | – | – | – | – | – | – | 2687.9 / 3105.7 | 579.2 / 627.8 | 0.2 / 0.4 | 0.0 / 0.3 |
| infisical | all-block | Stop:scan | 6 | 3434.3 / 4910.8 | 0.0 / 0.6 | 0.0 / 0.0 | 0.6 / 1.2 | 4.4 / 52.3 | – | – | – | – | – | – | – | 2777.1 / 4091.8 | 641.9 / 950.5 | 2.0 / 4.4 | 0.0 / 0.0 |
| midday | accept-only | PostToolUse:non-source | 3 | 22.3 / 29.9 | 0.0 / 4.9 | 0.0 / 0.0 | 0.4 / 0.4 | 2.8 / 6.0 | 18.0 / 19.5 | – | – | – | – | – | 0.0 / 0.0 | – | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| midday | accept-only | PostToolUse:source | 75 | 70.6 / 152.5 | 0.0 / 2.8 | 0.0 / 0.1 | 0.3 / 0.5 | 2.8 / 14.6 | 18.8 / 47.6 | 1.2 / 2.0 | 0.3 / 6.8 | 4.9 / 30.5 | 2.6 / 15.5 | 11.5 / 54.4 | 0.5 / 0.8 | – | 0.4 / 0.8 | 0.0 / 0.0 | 0.0 / 0.0 |
| midday | accept-only | PreToolUse | 75 | 0.7 / 3.5 | 0.0 / 1.7 | 0.0 / 0.0 | 0.4 / 0.5 | – | – | – | – | – | – | – | – | – | – | – | 0.0 / 0.0 |
| midday | accept-only | SessionStart | 3 | 468.8 / 516.6 | 0.2 / 0.2 | 0.0 / 0.0 | 0.4 / 0.4 | 3.3 / 4.5 | – | – | – | – | – | – | – | 337.7 / 405.3 | 95.4 / 113.1 | 0.2 / 4.3 | 0.0 / 0.1 |
| midday | accept-only | Stop:scan | 6 | 474.8 / 822.0 | 0.0 / 0.8 | 0.0 / 0.0 | 0.4 / 0.9 | 2.1 / 10.2 | – | – | – | – | – | – | – | 355.1 / 728.1 | 99.9 / 117.8 | 0.3 / 1.1 | 0.0 / 0.0 |
| midday | all | PostToolUse:non-source | 3 | 30.4 / 36.8 | 0.0 / 4.4 | 0.0 / 0.0 | 0.4 / 0.4 | 6.6 / 8.2 | 20.9 / 24.9 | – | – | – | – | – | 0.0 / 0.1 | – | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| midday | all | PostToolUse:source | 75 | 69.0 / 128.3 | 0.0 / 3.2 | 0.0 / 0.0 | 0.4 / 0.5 | 3.1 / 7.2 | 16.4 / 48.1 | 1.2 / 1.7 | 0.3 / 4.2 | 6.4 / 27.0 | 2.5 / 16.9 | 14.6 / 37.3 | 0.5 / 0.8 | – | 0.4 / 0.8 | 0.0 / 0.0 | 0.0 / 0.0 |
| midday | all | PreToolUse | 75 | 0.7 / 3.2 | 0.0 / 2.1 | 0.0 / 0.0 | 0.4 / 0.6 | – | – | – | – | – | – | – | – | – | – | – | 0.0 / 0.0 |
| midday | all | SessionStart | 3 | 595.6 / 714.9 | 0.1 / 2.4 | 0.0 / 0.0 | 0.3 / 0.4 | 2.1 / 4.8 | – | – | – | – | – | – | – | 454.9 / 593.6 | 97.6 / 123.8 | 0.4 / 0.7 | 0.1 / 0.1 |
| midday | all | Stop:no-scan | 6 | 0.7 / 6.0 | 0.0 / 5.4 | 0.0 / 0.0 | 0.4 / 0.4 | – | – | – | – | – | – | – | – | – | – | – | 0.0 / 0.0 |
| midday | all-block | PostToolUse:non-source | 3 | 24.4 / 26.5 | 0.0 / 0.0 | 0.0 / 0.0 | 0.4 / 0.4 | 4.8 / 9.0 | 18.6 / 22.1 | – | – | – | – | – | 0.0 / 0.0 | – | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| midday | all-block | PostToolUse:source | 75 | 69.1 / 177.1 | 0.0 / 2.8 | 0.0 / 0.0 | 0.3 / 0.7 | 2.6 / 9.6 | 16.8 / 65.9 | 1.2 / 2.4 | 0.2 / 3.7 | 4.0 / 26.9 | 2.5 / 8.5 | 18.5 / 60.2 | 0.5 / 0.9 | – | 0.4 / 0.9 | 0.0 / 0.0 | 0.0 / 0.0 |
| midday | all-block | PreToolUse | 75 | 0.7 / 3.5 | 0.0 / 1.8 | 0.0 / 0.0 | 0.4 / 0.5 | – | – | – | – | – | – | – | – | – | – | – | 0.0 / 0.0 |
| midday | all-block | SessionStart | 3 | 779.2 / 819.4 | 0.0 / 0.0 | 0.0 / 0.0 | 0.4 / 0.4 | 3.4 / 4.2 | – | – | – | – | – | – | – | 602.0 / 673.3 | 109.3 / 203.3 | 0.3 / 0.3 | 0.1 / 0.1 |
| midday | all-block | Stop:scan | 6 | 624.6 / 867.5 | 0.0 / 2.4 | 0.0 / 0.0 | 0.4 / 0.5 | 2.6 / 4.7 | – | – | – | – | – | – | – | 505.2 / 631.1 | 104.0 / 208.3 | 0.4 / 13.8 | 0.0 / 0.0 |

### Path taken (PostToolUse on source files, and Stop)

| repo | policy | hook | n | paths (path_r14: count) |
|---|---|---|---|---|
| dub | accept-only | PostToolUse:source | 45 | single_file: 45 |
| dub | accept-only | SessionStart | 3 | skipped: 3 |
| dub | accept-only | Stop:scan | 6 | full_scan: 6 |
| dub | all | PostToolUse:source | 45 | single_file: 45 |
| dub | all | SessionStart | 3 | skipped: 3 |
| dub | all | Stop:no-scan | 6 | skipped: 6 |
| dub | all-block | PostToolUse:source | 45 | single_file: 45 |
| dub | all-block | SessionStart | 3 | skipped: 3 |
| dub | all-block | Stop:scan | 6 | full_scan: 6 |
| infisical | accept-only | PostToolUse:source | 48 | single_file: 48 |
| infisical | accept-only | SessionStart | 3 | skipped: 3 |
| infisical | accept-only | Stop:scan | 6 | full_scan: 6 |
| infisical | all | PostToolUse:source | 48 | single_file: 48 |
| infisical | all | SessionStart | 3 | skipped: 3 |
| infisical | all | Stop:no-scan | 6 | skipped: 6 |
| infisical | all-block | PostToolUse:source | 48 | single_file: 48 |
| infisical | all-block | SessionStart | 3 | skipped: 3 |
| infisical | all-block | Stop:scan | 6 | full_scan: 6 |
| midday | accept-only | PostToolUse:source | 75 | single_file: 75 |
| midday | accept-only | SessionStart | 3 | skipped: 3 |
| midday | accept-only | Stop:scan | 6 | full_scan: 6 |
| midday | all | PostToolUse:source | 75 | single_file: 75 |
| midday | all | SessionStart | 3 | skipped: 3 |
| midday | all | Stop:no-scan | 6 | skipped: 6 |
| midday | all-block | PostToolUse:source | 75 | single_file: 75 |
| midday | all-block | SessionStart | 3 | skipped: 3 |
| midday | all-block | Stop:scan | 6 | full_scan: 6 |

PostToolUse on source files: 504 hooks, 0 took a full scan (0.0%); reasons {}
  all: PostToolUse source p50 85.1 ms p95 294.9 ms (n=168)
  all-block: PostToolUse source p50 89.3 ms p95 373.7 ms (n=168)
  accept-only: PostToolUse source p50 90.9 ms p95 431.8 ms (n=168)
counts per PostToolUse (mean): {'config_loads': 1.0, 'drift_config_loads': 4.0, 'state_loads': 1.0}
overhead dub: trace p50 85.1 ms vs main p50 75.5 ms (rep 0, same files)
overhead infisical: trace p50 259.4 ms vs main p50 260.7 ms (rep 0, same files)
overhead midday: trace p50 75.2 ms vs main p50 74.6 ms (rep 0, same files)
