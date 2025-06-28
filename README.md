# Quick Countertop Remnant Inventory Web App

A custom web interface for displaying and managing countertop remnants from Quick Countertop. Designed for internal use, external clients, and sales teams.

## 🧩 Features

- 🔍 **Filtering**
  - Filter remnants by:
    - ✅ Material type (checkboxes)
    - 🎨 Stone name (text search)
    - 📐 Size (including L-shape handling)
- 🧱 **Remnant Display**
  - Shows ID, stone name, size, status, and location
  - Dynamic grid with styled "remnant cards"
- 🖼 **Image Modal**
  - Zoom with pan control
  - Escape key or 'X' button to close
  - Click-to-close disabled (intentional)
- 🌈 **UI & Branding**
  - Clean layout with 3D/glass-like visual effects
  - Colors follow Quick Countertop branding: **orange, black, and white**
- 🔐 **Authentication (planned)**
  - Supabase Auth for partner logins (e.g. FRV, MAS, Torunier)
  - Each partner has access only to their own remnants

## 🛠 Tech Stack

- **Frontend**: HTML, CSS, Vanilla JS (no React)
- **Backend**: Supabase (PostgreSQL + Auth + Storage)
- **Images**: Pulled from Supabase Storage or linked files
- **Data Source**: Moraware scraping → CSV → Supabase import

## 🧾 Database Schema

| Field        | Description                       |
| ------------ | --------------------------------- |
| `id`         | Unique remnant ID (from Moraware) |
| `stone_name` | Name of the material              |
| `material`   | Material type (Granite, Quartz)   |
| `dimensions` | Size (single or L-shape)          |
| `thickness`  | Slab thickness                    |
| `status`     | Available, Sold, On Hold, etc.    |
| `location`   | Physical remnant location         |
| `color`      | Visual color tag                  |
| `image_url`  | Link to preview image             |
| `pricing`    | Price per piece or sqft           |

## 🚀 Setup & Deployment

1. Clone this repo
2. Link your Supabase project
3. Update API keys in the frontend config
4. Import remnant data from `original2.csv` or your own source
5. Deploy (Netlify, Vercel, GitHub Pages, etc.)

## ✅ Status

- ✔️ Initial remnant viewer working
- ✔️ Modal zoom and pan complete
- ✔️ CSV ingestion and image linking live
- 🔜 Admin auth + filtering by client (via Supabase)
- 🔜 Mobile responsiveness and image optimization

## 🤝 Collaborators

- **Lead Dev**: Hugo Fraga
- **Company**: Quick Countertop

## 📬 Contact

For bug reports, enhancements, or access requests, contact [Hugo Fraga] or your Quick admin.

---
