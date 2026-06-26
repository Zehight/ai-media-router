import { createMediaRouter } from "@miragari/ai-media-router"

const client = createMediaRouter()

const result = await client.generateImage(
  "a clean product render of a white desk lamp",
)

console.log(JSON.stringify(result, null, 2))
