import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { featuredMovies } from "../../data/moviesData";
import styles from "./Movies.module.scss";

export default function Movies() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedMovieParam = searchParams.get("movie");

  const [searchQuery, setSearchQuery] = useState("");
  const [activeGenre, setActiveGenre] = useState("All");
  const [selectedMovie, setSelectedMovie] = useState(null);

  useEffect(() => {
    if (selectedMovieParam) {
      const found = featuredMovies.find((m) => m.id === selectedMovieParam);
      if (found) setSelectedMovie(found);
    }
  }, [selectedMovieParam]);

  const genres = ["All", "Action", "Sci-Fi", "Concerts", "Drama"];

  const filteredMovies = featuredMovies.filter((movie) => {
    const matchesSearch =
      movie.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      movie.genre.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesGenre =
      activeGenre === "All" ||
      movie.genre.toLowerCase().includes(activeGenre.toLowerCase());

    return matchesSearch && matchesGenre;
  });

  const handleSelectShowtime = (movie, showtime) => {
    navigate(
      `/booking?movie=${movie.id}&title=${encodeURIComponent(
        movie.title
      )}&time=${encodeURIComponent(showtime.time)}&hall=${encodeURIComponent(
        showtime.hall
      )}`
    );
  };

  return (
    <div className={styles.moviesPage}>
      <div className={styles.container}>
        {/* PAGE HEADER */}
        <div className={styles.header}>
          <h1>Browse Movies & Events</h1>
          <p>Select your favorite show and pick your live seats</p>

          <div className={styles.searchFilterBar}>
            <div className={styles.searchBox}>
              <span>🔍</span>
              <input
                type="text"
                placeholder="Search by title, genre, artist..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className={styles.genreFilter}>
              {genres.map((g) => (
                <button
                  key={g}
                  className={`${styles.genreBtn} ${
                    activeGenre === g ? styles.activeGenre : ""
                  }`}
                  onClick={() => setActiveGenre(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* MOVIES CATALOG */}
        <div className={styles.catalogGrid}>
          {filteredMovies.map((movie) => (
            <div key={movie.id} className={styles.catalogCard}>
              <img src={movie.poster} alt={movie.title} className={styles.cardImg} />
              
              <div className={styles.cardContent}>
                <div className={styles.topMeta}>
                  <span className={styles.rating}>★ {movie.rating} ({movie.votes})</span>
                  <span className={styles.category}>{movie.category}</span>
                </div>

                <h2>{movie.title}</h2>
                <p className={styles.genre}>{movie.genre} • {movie.duration}</p>
                <p className={styles.description}>{movie.description}</p>

                <div className={styles.castSection}>
                  <strong>Starring:</strong> {movie.cast.join(", ")}
                </div>

                <div className={styles.showtimesSection}>
                  <h4>Available Showtimes:</h4>
                  <div className={styles.showtimePills}>
                    {movie.showtimes.map((st) => (
                      <button
                        key={st.id}
                        className={styles.showtimeBtn}
                        onClick={() => handleSelectShowtime(movie, st)}
                      >
                        <span className={styles.time}>{st.time}</span>
                        <span className={styles.type}>{st.type}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
