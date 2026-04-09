import { defineCollection, z } from "astro:content"

const docs = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    order: z.number().optional(),
  }),
})

export const collections = {
  docs,
}
