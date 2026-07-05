# Audio stream fixture

`tone-750hz-48k-mono-1s.mp3` is a deterministic one-second, 48 kHz mono,
32 kb/s CBR MP3 containing a 750 Hz sine wave. It has no ID3 or Xing header.

Generated with ffmpeg 8.0:

```sh
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "sine=frequency=750:sample_rate=48000:duration=1" \
  -map_metadata -1 -ac 1 -ar 48000 \
  -c:a libmp3lame -b:a 32k \
  -write_xing 0 -id3v2_version 0 -write_id3v1 0 \
  tone-750hz-48k-mono-1s.mp3
```

SHA-256: `82b137c8b36a174ea5c471c27dc55aaf0e3c978cb95b521dc37031e62441a94a`
