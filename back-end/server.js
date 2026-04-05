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
let movieData = new Map(); // movie -> { poster, genre, rating }
let allMovieNames = [];

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
    const genre = row.Genre ? row.Genre.split(",")[0].trim() : "Unknown";
    const poster = row.Poster_Link || "";
    const rating = parseFloat(row.IMDB_Rating) || 0;

    movieActors.set(movie, actors);
    movieData.set(movie, { poster, genre, rating, actors });
    allMovieNames.push(movie);

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
    .map(([title, score]) => {
      const data = movieData.get(title) || {};
      return { title, score, poster: data.poster, genre: data.genre, rating: data.rating };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

// Return graph data with genre and degree info
app.get("/matrix", (req, res) => {
  const actors = Array.from(actorIndex.keys());

  // Compute degree (number of collaborations) per actor
  const degrees = actors.map((_, i) =>
    adjMatrix[i].reduce((sum, v) => sum + (v > 0 ? 1 : 0), 0)
  );

  // Pick top 200 actors by degree to keep performance good
  const indexedActors = actors.map((name, i) => ({ name, degree: degrees[i], idx: i }));
  indexedActors.sort((a, b) => b.degree - a.degree);
  const topActors = indexedActors.slice(0, 200);
  const topActorSet = new Set(topActors.map(a => a.name));

  // Get genre for each actor: most common genre among their movies
  const actorGenre = {};
  topActors.forEach(({ name }) => {
    const genreCount = {};
    actorMovies.get(name).forEach(movie => {
      const g = movieData.get(movie)?.genre || "Unknown";
      genreCount[g] = (genreCount[g] || 0) + 1;
    });
    actorGenre[name] = Object.entries(genreCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown";
  });

  const nodes = topActors.map(({ name, degree }) => ({
    id: name,
    degree,
    genre: actorGenre[name],
    movieCount: actorMovies.get(name)?.size || 0,
  }));

  const links = [];
  const topActorOldIdx = topActors.map(a => a.idx);

  for (let i = 0; i < topActorOldIdx.length; i++) {
    for (let j = i + 1; j < topActorOldIdx.length; j++) {
      const w = adjMatrix[topActorOldIdx[i]][topActorOldIdx[j]];
      if (w > 0) {
        links.push({
          source: topActors[i].name,
          target: topActors[j].name,
          value: w,
        });
      }
    }
  }

  res.json({ nodes, links });
});

app.get("/recommend", (req, res) => {
  res.json(recommend(req.query.movie));
});

app.get("/movies", (req, res) => {
  res.json(allMovieNames);
});

// Top actors by degree
app.get("/top-actors", (req, res) => {
  const actors = Array.from(actorIndex.keys());
  const degrees = actors.map((name, i) => ({
    name,
    degree: adjMatrix[i].reduce((s, v) => s + (v > 0 ? 1 : 0), 0),
    movieCount: actorMovies.get(name)?.size || 0,
  }));
  degrees.sort((a, b) => b.degree - a.degree);
  res.json(degrees.slice(0, 10));
});

app.listen(5000, async () => {
  await buildGraph();
  console.log("🚀 Backend running on port 5000");
});