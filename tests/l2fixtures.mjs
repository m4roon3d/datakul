// Shared fakes for the layer 2 tests.
/* ---- fake embeddings: topic words decide the direction, so paraphrases land close together ---- */
const TOPICS = [["vector", "embedding", "similarity", "pinecone", "pgvector", "ann"], ["salary", "negotiat", "offer", "ctc"], ["kubernetes", "k8s", "pod"]];
export function fakeVec(t) {
  const s = t.toLowerCase(), v = new Array(16).fill(0);
  TOPICS.forEach((ws, i) => ws.forEach((w) => { if (s.includes(w)) v[i] += 1; }));
  let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = 3; i < 16; i++) v[i] = (((h >> i) & 7) / 7) * 0.15; // small, question-specific noise
  if (v[0] + v[1] + v[2] === 0) v[3 + (h % 13)] += 1;
  return v;
}

/* ---- a fake LLM: the first draft has a model answer that misses a key point; the repair fixes it ---- */
export const GOOD = {
  concept: {
    title: "Vector databases", t: "ds", lv: "I",
    kw: "vector database embeddings similarity search nearest neighbour ann hnsw pgvector pinecone rag retrieval cosine",
    s: "A vector database stores embeddings and finds the items most similar to a query vector. It is the retrieval half of most RAG systems.",
    d: "Text, images or products are turned into embeddings by a model. The database indexes those vectors, usually with an approximate nearest neighbour index such as HNSW, so a query can find the closest items in milliseconds instead of comparing against every row. You trade a little recall for a lot of speed. Filters on metadata, re-ranking and keeping embeddings in sync with the source data matter as much as the index.",
    e: "A support bot embeds 50,000 help articles, stores them in pgvector, and for each customer question retrieves the five closest articles to ground its answer.",
    c: "Your RAG bot returns outdated answers after a product change. What in the vector store would you check first?",
    i: "Interviewers probe why approximate search is fine, how you measure recall, and how you keep embeddings fresh when documents change.",
  },
  questions: [
    { q: "How would you choose between pgvector and a dedicated vector database for a RAG product?", r: ["ds", "de"], l: "m", d: ["saas"], tg: ["python"],
      p: [{ t: "Scale and latency needs decide", k: ["latency", "million", "scale", "throughput"] }, { t: "Approximate nearest neighbour index such as HNSW", k: ["hnsw", "approximate", "ann", "nearest neighbour"] }, { t: "Metadata filtering and hybrid search", k: ["metadata", "filter", "hybrid", "keyword search"] }],
      a: "It depends on scale and latency. With a few million vectors and modest throughput, pgvector inside Postgres keeps one system and transactions. Both use an approximate nearest neighbour index like HNSW, trading a little recall for speed. I would also check metadata filter support and hybrid keyword search, since most RAG queries need both." },
    { q: "Your RAG answers got worse after documents were updated. How do you find and fix the cause?", r: ["ds"], l: "m", d: ["any"], tg: ["python"],
      p: [{ t: "Stale embeddings that were never re-indexed", k: ["stale", "re-embed", "reindex", "re-index", "out of date"] }, { t: "Measure retrieval recall on a labelled set", k: ["recall", "golden set", "labelled", "evaluation set"] }, { t: "Version the embedding model", k: ["embedding model", "model version", "same model"] }],
      a: "First I would check for stale embeddings: updated documents that were never re-embedded or were re-indexed only partly. Then I would measure retrieval recall on a small labelled golden set to confirm the right chunks come back. Finally I would make sure every vector was built with the same embedding model version, because mixing models breaks similarity." },
  ],
};
