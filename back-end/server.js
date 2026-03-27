import express from "express";
import fs from "fs";
import cors from "cors";
import path from "path";
import csv from "csv-parser";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILE_PATH = path.join(__dirname, "imdb_top_1000.csv");

class Actor {
  constructor(name) {
    this.name = name;
    this.movies = new Set();
  }
  addMovie(movie) {
    this.movies.add(movie);
  }
}

class Graph {
  constructor() {
    this.actors = new Map();
    this.actorIndex = new Map();
    this.adjMatrix = [];
  }

  addMovieToActor(actorName, movie) {
    if (!this.actors.has(actorName)) {
      this.actors.set(actorName, new Actor(actorName));
    }
    this.actors.get(actorName).addMovie(movie);
  }

  buildMatrixFast(rows) {
    const actorNames = Array.from(this.actors.keys());
    actorNames.forEach((name, i) => this.actorIndex.set(name, i));
    const n = actorNames.length;
    this.adjMatrix = Array.from({ length: n }, () => Array(n).fill(0));

    rows.forEach((row) => {
      const actors = [row.Star1, row.Star2, row.Star3, row.Star4].filter(Boolean);
      for (let i = 0; i < actors.length; i++) {
        for (let j = i + 1; j < actors.length; j++) {
          const a = this.actorIndex.get(actors[i]);
          const b = this.actorIndex.get(actors[j]);
          if (a !== undefined && b !== undefined) {
            this.adjMatrix[a][b] += 1;
            this.adjMatrix[b][a] += 1;
          }
        }
      }
    });
  }
}

// Filter top actors and strong links
function filterGraph(graphData, maxActors = 100, minCollab = 2) {
  const { actors, matrix } = graphData;

  // compute degree for each actor
  const degrees = actors.map((_, i) =>
    matrix[i].reduce((sum, v) => sum + (v >= minCollab ? 1 : 0), 0)
  );

  const sortedIndexes = actors.map((_, i) => i)
    .sort((a, b) => degrees[b] - degrees[a])
    .slice(0, maxActors);

  const filteredActors = sortedIndexes.map(i => actors[i]);
  const filteredMatrix = sortedIndexes.map(i =>
    sortedIndexes.map(j => matrix[i][j])
  );

  return { actors: filteredActors, matrix: filteredMatrix };
}

function parseCSVFile() {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(FILE_PATH)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", (err) => reject(err));
  });
}

async function buildGraph() {
  const graph = new Graph();
  const rows = await parseCSVFile();

  rows.forEach(row => {
    const actors = [row.Star1, row.Star2, row.Star3, row.Star4].filter(Boolean);
    actors.forEach(actor => graph.addMovieToActor(actor, row.Series_Title));
  });

  graph.buildMatrixFast(rows);

  return filterGraph(
    {
      actors: Array.from(graph.actorIndex.keys()),
      matrix: graph.adjMatrix
    },
    200, // top 100 actors
    0    // only links with 2+ collaborations
  );
}

app.get("/matrix", async (req, res) => {
  try {
    const data = await buildGraph();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error building graph");
  }
});

app.listen(5000, () => console.log("🚀 Server running on http://localhost:5000"));