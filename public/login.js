document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = e.target.email.value;
    const password = e.target.password.value;

    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });

        const result = await res.json();

        if (res.ok) {
            window.location.href = "/admin.html";
        } else {
            document.getElementById("error").textContent =
                result.error || "Login failed";
        }
    } catch (err) {
        console.error("Login request failed:", err);
        document.getElementById("error").textContent = "Server error. Try again.";
    }
});
