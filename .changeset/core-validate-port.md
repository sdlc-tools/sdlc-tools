---
'@sdlc-tools/core': minor
---

`validatePort` is exported: it checks a TCP port given as a setting (whole numbers from 1 to 65535, otherwise a usage error with code `invalid_port`) and can be passed as a setting's `validate`.
