const express = require("express");
const router = express.Router();
const supabase = require('../supabaseClient');

// POST /api/login
router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    console.log(error)
    if (error) return res.status(401).json({ error: "Invalid credentials" });


    res.cookie("sb-access-token", data.session.access_token, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        maxAge: 60 * 60 * 24,
    });

    res.json({ message: "Login successful" });
});

// GET /api/login — Not allowed
router.get("/login", (req, res) => {
    res.status(405).json({ error: "GET not allowed. Use POST to log in." });
});

module.exports = router;
