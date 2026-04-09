import express from "express";
import fs from "fs";
import cors from "cors";
import csv from "csv-parser";

const app = express();
app.use(cors());

// ─── Preserved Datasets ────────────────────────────────────────────────
// movieActors : movie  → [actor, ...]
// movieData   : movie  → { poster, genre, rating, actors }
// allMovieNames: string[]

let movieActors = new Map();
let movieData = new Map();
let allMovieNames = [];

// ─── Actor lookup (kept for recommend() scoring logic) ──────────────────
// actorMovies : actor → Set<movie>
// actorIndex  : actor → integer index (used only inside recommend())

let actorMovies = new Map();
let actorIndex = new Map();

// ─── Director lookup ────────────────────────────────────────────────────
// directorMovies : director → Set<movie>
let directorMovies = new Map();

// ─── NEW: Movie-based graph structures ──────────────────────────────────
// movieIndex  : movie → integer index into adjMatrix
// adjMatrix   : movie × movie  (adjMatrix[i][j] = number of shared actors)

let movieIndex = new Map();
let adjMatrix = [];

// ───────────────────────────────────────────────────────────────────────
function loadCSV() {
  return new Promise((resolve) => {
    const rows = [];
    fs.createReadStream("imdb_top_1000.csv")
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows));
  });
}

// ───────────────────────────────────────────────────────────────────────
async function buildGraph() {
  const rows = await loadCSV();

  // ── Pass 1: Collect movie metadata and actor↔movie relationships ──────
  rows.forEach((row) => {
    const movie = row.Series_Title;
    const actors = [row.Star1, row.Star2, row.Star3, row.Star4].filter(Boolean);
    const genre = row.Genre ? row.Genre.split(",")[0].trim() : "Unknown";
    const poster = row.Poster_Link || "";
    const rating = parseFloat(row.IMDB_Rating) || 0;
    const director = row.Director || "";

    // Preserved datasets
    movieActors.set(movie, actors);
    movieData.set(movie, { poster, genre, rating, actors, director });
    allMovieNames.push(movie);

    // Build actorMovies (needed by recommend())
    actors.forEach((actor) => {
      if (!actorMovies.has(actor)) actorMovies.set(actor, new Set());
      actorMovies.get(actor).add(movie);
    });

    // Build directorMovies
    if (director) {
      if (!directorMovies.has(director)) directorMovies.set(director, new Set());
      directorMovies.get(director).add(movie);
    }
  });

  // ── Build actorIndex (needed by recommend()) ──────────────────────────
  const actorList = Array.from(actorMovies.keys());
  actorList.forEach((a, i) => actorIndex.set(a, i));

  // ── Pass 2: Build MOVIE adjacency matrix ─────────────────────────────
  // Assign each movie an integer index
  allMovieNames.forEach((movie, i) => movieIndex.set(movie, i));

  const n = allMovieNames.length;

  // Initialise n × n matrix with zeros
  adjMatrix = Array.from({ length: n }, () => Array(n).fill(0));

  // For every actor, connect all pairs of movies they appeared in.
  // Increment adjMatrix[i][j] for each shared actor → edge weight = shared actors.
  actorMovies.forEach((movies) => {
    const movieList = Array.from(movies);
    for (let i = 0; i < movieList.length; i++) {
      for (let j = i + 1; j < movieList.length; j++) {
        const a = movieIndex.get(movieList[i]);
        const b = movieIndex.get(movieList[j]);
        if (a !== undefined && b !== undefined) {
          adjMatrix[a][b]++;
          adjMatrix[b][a]++;
        }
      }
    }
  });

  // For every director, connect all pairs of their movies.
  // Each shared director adds 2 to the edge weight (a strong signal).
  directorMovies.forEach((movies) => {
    const movieList = Array.from(movies);
    for (let i = 0; i < movieList.length; i++) {
      for (let j = i + 1; j < movieList.length; j++) {
        const a = movieIndex.get(movieList[i]);
        const b = movieIndex.get(movieList[j]);
        if (a !== undefined && b !== undefined) {
          adjMatrix[a][b] += 2;
          adjMatrix[b][a] += 2;
        }
      }
    }
  });
}

// ───────────────────────────────────────────────────────────────────────
// recommend() still relies on actorMovies + actorIndex for collaborative
// scoring — no changes needed here.
function recommend(movie) {
  const baseActors = movieActors.get(movie);
  if (!baseActors) return [];

  const scores = {};

  baseActors.forEach((actor) => {
    const idx = actorIndex.get(actor);

    // +5 for every movie the same actor appeared in
    actorMovies.get(actor).forEach((m) => {
      if (m !== movie) scores[m] = (scores[m] || 0) + 5;
    });

    // Additional weight from actor–actor collaboration graph row
    // (kept intact to preserve recommendation quality)
    const actorList = Array.from(actorIndex.keys());
    actorList.forEach((neighbor, j) => {
      // Build a temporary actor adjMatrix row on the fly using actorIndex
      // This mirrors the old behaviour without storing the actor matrix.
      actorMovies.get(neighbor)?.forEach((m) => {
        if (m !== movie) {
          // Shared-movie count between baseActor and neighbor
          const shared = [...(actorMovies.get(actor) || [])].filter((mv) =>
            actorMovies.get(neighbor)?.has(mv)
          ).length;
          if (shared > 0) scores[m] = (scores[m] || 0) + shared;
        }
      });
    });
  });

  // +8 bonus for every movie by the same director (strong thematic signal)
  const baseDirector = movieData.get(movie)?.director;
  if (baseDirector && directorMovies.has(baseDirector)) {
    directorMovies.get(baseDirector).forEach((m) => {
      if (m !== movie) scores[m] = (scores[m] || 0) + 8;
    });
  }

  return Object.entries(scores)
    .map(([title, score]) => {
      const data = movieData.get(title) || {};
      return { title, score, poster: data.poster, genre: data.genre, rating: data.rating };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

// ─── /matrix ────────────────────────────────────────────────────────────
// Returns a Movie Similarity Network:
//   nodes → { id: movieTitle, genre, rating, poster }
//   links → { source: movieA, target: movieB, value: sharedActorCount }
//
// To keep the graph performant we cap at the top-N most-connected movies.
app.get("/matrix", (req, res) => {
  const MAX_NODES = 300; // tune as needed

  // Compute connectivity degree for each movie (how many other movies it connects to)
  const movieDegrees = allMovieNames.map((movie, i) => ({
    movie,
    degree: adjMatrix[i].reduce((sum, v) => sum + (v > 0 ? 1 : 0), 0),
    index: i,
  }));

  // Sort by degree descending and pick the top MAX_NODES
  movieDegrees.sort((a, b) => b.degree - a.degree);
  const topMovies = movieDegrees.slice(0, MAX_NODES);
  const topMovieSet = new Set(topMovies.map((m) => m.movie));

  // Build node list — each node carries genre, rating, poster, and director
  const nodes = topMovies.map(({ movie }) => {
    const data = movieData.get(movie) || {};
    return {
      id: movie,
      genre: data.genre || "Unknown",
      rating: data.rating || 0,
      poster: data.poster || "",
      director: data.director || "Unknown",
    };
  });

  // Build edge list — only between movies that are both in topMovieSet
  const links = [];
  for (let i = 0; i < topMovies.length; i++) {
    for (let j = i + 1; j < topMovies.length; j++) {
      const idxA = topMovies[i].index;
      const idxB = topMovies[j].index;
      const sharedActors = adjMatrix[idxA][idxB];
      if (sharedActors > 0) {
        links.push({
          source: topMovies[i].movie,
          target: topMovies[j].movie,
          value: sharedActors, // number of shared actors = edge thickness
        });
      }
    }
  }

  res.json({ nodes, links });
});

// ─── /recommend ──────────────────────────────────────────────────────────
app.get("/recommend", (req, res) => {
  res.json(recommend(req.query.movie));
});

// ─── /movies ─────────────────────────────────────────────────────────────
app.get("/movies", (req, res) => {
  res.json(allMovieNames);
});

// ─── /top-actors (preserved for any existing frontend usage) ─────────────
app.get("/top-actors", (req, res) => {
  const actorList = Array.from(actorIndex.keys());
  const degrees = actorList.map((name, i) => ({
    name,
    degree: actorMovies.get(name)?.size || 0,
    movieCount: actorMovies.get(name)?.size || 0,
  }));
  degrees.sort((a, b) => b.degree - a.degree);
  res.json(degrees.slice(0, 10));
});

// ─── Start ───────────────────────────────────────────────────────────────
app.listen(5000, async () => {
  await buildGraph();
  console.log("🚀 Backend running on port 5000");
  console.log(`   Movies indexed : ${movieIndex.size}`);
  console.log(`   Actors indexed : ${actorIndex.size}`);
});