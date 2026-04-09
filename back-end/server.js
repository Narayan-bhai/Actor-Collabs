import express from "express";
import fs from "fs";
import cors from "cors";
import csv from "csv-parser";

const app = express();
app.use(cors());

let movieActors = new Map();
let movieData = new Map();
let allMovieNames = [];

let actorMovies = new Map();
let actorIndex = new Map();

let directorMovies = new Map();


let movieIndex = new Map();
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


  rows.forEach((row) => {
    const movie = row.Series_Title;
    const actors = [row.Star1, row.Star2, row.Star3, row.Star4].filter(Boolean);
    const genre = row.Genre ? row.Genre.split(",")[0].trim() : "Unknown";
    const poster = row.Poster_Link || "";
    const rating = parseFloat(row.IMDB_Rating) || 0;
    const director = row.Director || "";

  
    movieActors.set(movie, actors);
    movieData.set(movie, { poster, genre, rating, actors, director });
    allMovieNames.push(movie);

  
    actors.forEach((actor) => {
      if (!actorMovies.has(actor)) actorMovies.set(actor, new Set());
      actorMovies.get(actor).add(movie);
    });

  
    if (director) {
      if (!directorMovies.has(director)) directorMovies.set(director, new Set());
      directorMovies.get(director).add(movie);
    }
  });


  const actorList = Array.from(actorMovies.keys());
  actorList.forEach((a, i) => actorIndex.set(a, i));



  allMovieNames.forEach((movie, i) => movieIndex.set(movie, i));

  const n = allMovieNames.length;


  adjMatrix = Array.from({ length: n }, () => Array(n).fill(0));



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

function recommend(movie) {
  if (!movieIndex.has(movie)) return [];
  const baseIndex = movieIndex.get(movie);
  const baseActors = new Set(movieActors.get(movie));
  const baseDirector = movieData.get(movie)?.director;
  const scores = {};
  const visited = new Set([baseIndex]);
  const queue = [baseIndex];
  const n = adjMatrix.length;

  while (queue.length) {
    const i = queue.shift();
    for (let j = 0; j < n; j++) {
      if (adjMatrix[i][j] > 0 && !visited.has(j)) {
        visited.add(j);
        const m = allMovieNames[j];
        let score = 0;
        const actors = movieActors.get(m) || [];
        actors.forEach((actor) => {
          if (baseActors.has(actor)) score += 4;
        });

        if (movieData.get(m)?.director === baseDirector) {
          score += 6;
        }

        if (score > 0) {
          scores[m] = (scores[m] || 0) + score;
          queue.push(j);
        }
      }
    }
  }

  return  Object.entries(scores)
          .map(([title, score]) => {
            const data = movieData.get(title) || {};
            return { title, score, poster: data.poster, genre: data.genre, rating: data.rating };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 12);
}
app.get("/matrix", (req, res) => {
  const MAX_NODES = 300;


  const movieDegrees = allMovieNames.map((movie, i) => ({
    movie,
    degree: adjMatrix[i].reduce((sum, v) => sum + (v > 0 ? 1 : 0), 0),
    index: i,
  }));


  movieDegrees.sort((a, b) => b.degree - a.degree);
  const topMovies = movieDegrees.slice(0, MAX_NODES);
  const topMovieSet = new Set(topMovies.map((m) => m.movie));


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
          value: sharedActors,
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

app.listen(5000, async () => {
  await buildGraph();
  console.log("🚀 Backend running on port 5000");
  console.log(`   Movies indexed : ${movieIndex.size}`);
  console.log(`   Actors indexed : ${actorIndex.size}`);
});