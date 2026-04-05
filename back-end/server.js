import express from "express";
import fs from "fs";
import cors from "cors";
import csv from "csv-parser";

const app = express();
app.use(cors());

let movieActors = new Map();
let actorMovies = new Map();
let actorIndex = new Map();
let adjMatrix = [];

function loadCSV() {
  return new Promise((resolve) => {
    const rows = [];
    fs.createReadStream("imdb_top_1000.csv")
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows));
  });
}

async function buildGraph() {
  const rows = await loadCSV();

  rows.forEach(row => {
    const movie = row.Series_Title;
    const actors = [row.Star1, row.Star2, row.Star3, row.Star4].filter(Boolean);

    movieActors.set(movie, actors);

    actors.forEach(actor => {
      if (!actorMovies.has(actor)) actorMovies.set(actor, new Set());
      actorMovies.get(actor).add(movie);
    });
  });

  const actors = Array.from(actorMovies.keys());
  actors.forEach((a, i) => actorIndex.set(a, i));

  adjMatrix = Array.from({ length: actors.length }, () =>
    Array(actors.length).fill(0)
  );

  rows.forEach(row => {
    const actors = [row.Star1, row.Star2, row.Star3, row.Star4].filter(Boolean);
    for (let i = 0; i < actors.length; i++) {
      for (let j = i + 1; j < actors.length; j++) {
        const a = actorIndex.get(actors[i]);
        const b = actorIndex.get(actors[j]);
        adjMatrix[a][b]++;
        adjMatrix[b][a]++;
      }
    }
  });
}

function recommend(movie) {
  const baseActors = movieActors.get(movie);
  if (!baseActors) return [];

  const scores = {};

  baseActors.forEach(actor => {
    const idx = actorIndex.get(actor);

    actorMovies.get(actor).forEach(m => {
      if (m !== movie) scores[m] = (scores[m] || 0) + 5;
    });

    adjMatrix[idx].forEach((w, j) => {
      if (w > 0) {
        const neighbor = Array.from(actorIndex.keys())[j];
        actorMovies.get(neighbor).forEach(m => {
          if (m !== movie) scores[m] = (scores[m] || 0) + w;
        });
      }
    });
  });

  return Object.entries(scores)
    .map(([title, score]) => ({ title, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

app.get("/recommend", (req, res) => {
  res.json(recommend(req.query.movie));
});

app.get("/matrix", (req, res) => {
  const actors = Array.from(actorIndex.keys());
  res.json({ actors, matrix: adjMatrix });
});

app.listen(5000, async () => {
  await buildGraph();
  console.log("🚀 Backend running");
});