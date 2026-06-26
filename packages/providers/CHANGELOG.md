# @miragari/ai-media-router

## 0.2.2

### Patch Changes

- Send only `["IMAGE"]` for Gemini image generation `responseModalities` instead of mixing in `"TEXT"`.

## 0.2.1

### Patch Changes

- Bind the default global fetch before exposing it to provider runtimes, which fixes browser environments where calling an unbound `window.fetch` throws `Illegal invocation`.
- Updated dependencies
  - @miragari/ai-media-router-client@0.2.1

## 0.2.0

### Minor Changes

- Rename the public package family and repository branding to AI Media Router for better discoverability.

### Patch Changes

- Updated dependencies
  - @miragari/ai-media-router-core@0.2.0
  - @miragari/ai-media-router-client@0.2.0

## 0.1.1

### Patch Changes

- Republish packages with MIT license metadata and refreshed public repository documentation.
- Updated dependencies
  - @miragari/ai-media-router-core@0.1.1
  - @miragari/ai-media-router-client@0.1.1
