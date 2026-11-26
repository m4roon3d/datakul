// A made-up analysis in the shape Gemini is asked for, used by tests/video.mjs and the browser test server.
export const sampleVideo = () => ({
  title: "Auto Loader in 20 minutes", channel: "Example Data Channel", minutes: 21, track: "de", level: "work", topic: "Auto Loader",
  summary: "How Auto Loader picks up new files incrementally and how to set it up for a bronze table.",
  chapters: [
    { title: "Why incremental ingestion", start: "0:00", summary: "Reading every file on every run gets slow and costly. Incremental ingestion only reads files that arrived since the last run.",
      points: ["Full re-reads grow with the data, not with what changed", "Checkpoints remember which files were already loaded"],
      quiz: [
        { q: "What does incremental ingestion avoid?", opts: ["Re-reading files already loaded", "Writing to Delta tables", "Using a schema", "Running on a schedule"], ans: 0, why: "It only reads files that arrived since the last run, so old files are not read again." },
        { q: "What remembers which files were already loaded?", opts: ["The cluster log", "The checkpoint", "The table comment", "The notebook title"], ans: 1, why: "The checkpoint location stores progress so a restart continues where it stopped." },
      ] },
    { title: "Setting up cloudFiles", start: "4:30", summary: "Auto Loader is the cloudFiles source in a readStream. You set the file format and a schema location.",
      points: ["Use format('cloudFiles') with cloudFiles.format", "A schema location lets it infer and track the schema"],
      quiz: [
        { q: "Which source name does Auto Loader use in readStream?", opts: ["delta", "kafka", "cloudFiles", "jdbc"], ans: 2, why: "Auto Loader is used through the cloudFiles source in Structured Streaming." },
        { q: "What does cloudFiles.schemaLocation give you?", opts: ["Faster clusters", "Somewhere to store the inferred schema over time", "A backup of the files", "A dashboard"], ans: 1, why: "It stores the inferred schema so changes can be tracked across runs." },
      ] },
    { title: "Schema changes", start: "12:05", summary: "When new columns appear, Auto Loader can stop, add them, or put unexpected data in a rescue column.",
      points: ["Schema evolution modes decide what happens to new columns", "The rescued data column keeps values that don't fit"],
      quiz: [
        { q: "Where does data that doesn't match the schema go?", opts: ["It is deleted", "The rescued data column", "A new table", "The driver log"], ans: 1, why: "The rescued data column keeps values that don't fit, so nothing is lost silently." },
        { q: "What decides how new columns are handled?", opts: ["The schema evolution mode", "The cluster size", "The file name", "The job title"], ans: 0, why: "The schema evolution mode sets whether the stream fails, adds the column, or rescues it." },
      ] },
  ],
  takeaways: ["Auto Loader reads only new files", "Always set a checkpoint and schema location", "Plan how schema changes are handled"],
});
