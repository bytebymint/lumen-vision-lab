# Third-Party Asset Notice

This project vendors browser-side computer-vision runtimes and model artifacts so it can run locally without downloading models at startup.

| Component | Location | Upstream project |
| --- | --- | --- |
| MediaPipe Tasks Vision runtime and hand/face models | `static/vendor/mediapipe/`, `static/models/` | [Google AI Edge MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision) |
| Human JavaScript runtime and face models | `static/vendor/human/` | [Vladmandic Human](https://github.com/vladmandic/human) |
| EfficientDet Lite phone detector model | `static/models/efficientdet_lite0.tflite` | [TensorFlow Lite](https://www.tensorflow.org/lite) |

Before a public release, verify the exact license and attribution requirements for every bundled binary against the source/version from which it was obtained. This repository does not include a project license yet; choose one deliberately before making it public.
