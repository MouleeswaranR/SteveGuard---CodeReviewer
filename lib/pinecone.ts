import { Pinecone } from "@pinecone-database/pinecone";

if (!process.env.PINECONE_DB_API_KEY) {
  throw new Error("PINECONE_DB_API_KEY is not defined in environment variables");
}

export const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_DB_API_KEY, 
});

export const pineconeIndex = pinecone.index("code-reviewer-vector-embedding");