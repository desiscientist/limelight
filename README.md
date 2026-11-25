# Limelight

A full-stack video streaming platform in the style of Netflix and Apple TV, built with Node.js, Express and FFmpeg: adaptive HLS streaming, automatic transcoding, a custom video player, viewer accounts, comments and likes.

Only the owner can upload. Anyone can watch without an account; viewers who sign up can like/dislike, comment, and get Continue Watching across devices.

## Run it
1. `npm install`
2. Copy `.env.example` to `.env` and set `ADMIN_PASSWORD`
3. `npm start`, then open http://localhost:3001

- Public site: `/` (home, search, categories) and `/watch?v=...`
- Owner page: `/admin`, where you upload, edit, set thumbnails, read viewer reports, and delete
- Embeddable player: `/embed/<video id>`

## What happens after an upload
The video is live straight away in its original quality. In the background the server then makes:
- lower qualities (720p, 480p, 360p… below your original)
- a cover image (you can replace it on the admin page)
- small preview images for the progress bar
- a streaming version for the "Auto" quality option (HLS)

The admin page shows the progress of each step.

## Where things are stored
- `data/videos/`: video files, thumbnails, preview images and streaming chunks
- `data/videos.json`: titles, descriptions, tags, views, likes, watch heatmaps
- `data/users.json`: viewer accounts and their Continue Watching
- `data/comments.json`: comments
- `data/secret.key`: keeps viewers signed in; keep it private and back it up
- `data/reports.json`: problems reported by viewers
- `data/searches.json`: popular searches (only searches that found a video)

Back up the whole `data/` folder.

## Viewer accounts
- Sign up with name, email and password (passwords are stored hashed, never in plain text).
- Accounts are needed to like/dislike (one vote per account) and to comment. Viewers can delete their own comments; you can delete any comment while signed in to /admin.
- Continue Watching is saved per account on the server.
- Viewers can change their password from the account menu, and use "Forgot password?" in the sign-in window.

### Password reset emails
Without email settings, reset links are printed in the server console, and you can create one for any viewer from
**/admin → Viewer accounts → Create reset link** and send it to them yourself. Links work once, for 1 hour.

To email them automatically, add these to `.env` and restart (Gmail example: turn on 2-step verification, then create an App Password):
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
MAIL_FROM=Limelight <you@gmail.com>
PUBLIC_URL=https://your-site-address
```

## Saved only in each visitor's browser
Volume, quality, autoplay and theater mode.

## Placeholder videos (for testing the look)
- `npm run placeholders`: add 55 sample videos. With `TMDB_API_KEY` in `.env` they use real movie and TV backdrops, titles and descriptions from [TMDB](https://www.themoviedb.org/) (the footer then shows TMDB's required credit); without a key they are plain generated clips
- `npm run placeholders:remove`: delete them (your real videos are kept)

## Put it online
Use a host with a persistent disk, for example a small VPS, Render with a disk, or Railway with a volume.
Set the environment variables there (`ADMIN_PASSWORD`, `SITE_NAME`, `TRUST_PROXY=1`) and run `npm start`.
Serve it over HTTPS. Share links, embed codes and casting to a TV only work properly once the site has a real web address.
