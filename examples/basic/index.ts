import { createMediaRouter } from "@media-router/providers"

const client = createMediaRouter()

const result = await client.generateImage(
  "a clean product render of a white desk lamp",
)

console.log(JSON.stringify(result, null, 2))
