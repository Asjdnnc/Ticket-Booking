import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import styles from "./AuthModal.module.scss";

export default function AuthModal() {
  const { isAuthModalOpen, closeAuthModal, login, register } = useAuth();
  const [tab, setTab] = useState("login"); // 'login' | 'register'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isAuthModalOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setLoading(true);

    try {
      if (tab === "login") {
        await login({ email, password });
      } else {
        await register({ name, email, password });
      }
    } catch (err) {
      setErrorMsg(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (newTab) => {
    setTab(newTab);
    setErrorMsg("");
  };

  return (
    <div className={styles.overlay} onClick={closeAuthModal}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={closeAuthModal}>
          ✕
        </button>

        <div className={styles.header}>
          <h2>{tab === "login" ? "Welcome Back" : "Create Account"}</h2>
          <p>Sign in to proceed with your live seat bookings</p>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tabBtn} ${tab === "login" ? styles.active : ""}`}
            onClick={() => handleTabChange("login")}
          >
            Sign In
          </button>
          <button
            className={`${styles.tabBtn} ${tab === "register" ? styles.active : ""}`}
            onClick={() => handleTabChange("register")}
          >
            Register
          </button>
        </div>

        {errorMsg && <div className={styles.errorBox}>{errorMsg}</div>}

        <form onSubmit={handleSubmit} className={styles.form}>
          {tab === "register" && (
            <div className={styles.inputGroup}>
              <label>Full Name</label>
              <input
                type="text"
                placeholder="Enter your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          )}

          <div className={styles.inputGroup}>
            <label>Email Address</label>
            <input
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className={styles.inputGroup}>
            <label>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? "Processing..." : tab === "login" ? "Sign In & Continue" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
