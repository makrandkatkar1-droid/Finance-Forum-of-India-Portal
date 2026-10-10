"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const THEME = { green: "#7BBA27", greenDark: "#5C9420", navy: "#0B1D2E", bg: "#F5F6F1", border: "#E4E1D8", textMuted: "#6B6A63" };

// Forces light-themed form controls (background/text) regardless of the
// visitor's OS/browser dark-mode setting, which otherwise can make input
// text render white-on-white and become invisible.
const inputStyle: React.CSSProperties = {
  colorScheme: "light",
  color: "#111111",
  backgroundColor: "#FFFFFF",
};

export default function LoginPage() {
  const router = useRouter();
  const [checkedSession, setCheckedSession] = useState(false);

  const [role, setRole] = useState<"faculty" | "admin" | "student">("faculty");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (d.user) { router.replace("/dashboard"); return; }
      setCheckedSession(true);
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed.");
        setLoading(false);
        return;
      }
      router.push("/dashboard");
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  if (!checkedSession) {
    return <div className="flex items-center justify-center min-h-screen" style={{ color: THEME.textMuted }}>Loading...</div>;
  }

  return (
    <div className="flex flex-1 items-center justify-center min-h-screen p-5" style={{ background: `linear-gradient(160deg, ${THEME.green} 0%, #4E7A1E 55%, ${THEME.navy} 100%)` }}>
      <div className="w-[380px] p-9 rounded-2xl bg-white shadow-2xl">
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="w-[68px] h-[68px] rounded-2xl flex items-center justify-center" style={{ background: THEME.bg }}>
            <Image src="/ffoi-logo.png" alt="FFOI logo" width={44} height={44} />
          </div>
          <div className="text-lg font-bold text-center" style={{ color: THEME.navy }}>Finance Forum of India</div>
          <div className="text-sm text-center" style={{ color: THEME.textMuted }}>Weekly plan &amp; progress portal</div>
        </div>

        <div className="flex gap-1 mb-6 bg-[#F0EEE6] p-1.5 rounded-lg">
          {(["faculty", "admin", "student"] as const).map((r) => (
            <button key={r} type="button" onClick={() => setRole(r)}
              className="flex-1 py-2 text-sm rounded-md transition-colors font-medium"
              style={{ background: role === r ? THEME.green : "transparent", color: role === r ? "#fff" : THEME.textMuted }}>
              {r === "admin" ? "Admin" : r === "faculty" ? "Faculty" : "Student"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <label className="text-xs font-semibold" style={{ color: THEME.navy }}>Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username"
            className="w-full px-3.5 py-3 mt-1.5 mb-4 rounded-lg text-sm outline-none border-2 border-[#D8D4C6] focus:border-green-600"
            style={inputStyle} />
          <label className="text-xs font-semibold" style={{ color: THEME.navy }}>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
            className="w-full px-3.5 py-3 mt-1.5 mb-5 rounded-lg text-sm outline-none border-2 border-[#D8D4C6] focus:border-green-600"
            style={inputStyle} />
          {error && <div className="text-sm mb-3.5 px-3 py-2 rounded-lg" style={{ color: "#A32D2D", background: "#FCEBEB" }}>{error}</div>}
          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-lg text-white text-[15px] font-bold disabled:opacity-60" style={{ background: THEME.green }}>
            {loading ? "Logging in..." : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
