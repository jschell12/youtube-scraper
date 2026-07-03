import app from './server.mjs';

const port = parseInt(process.env.PORT || '3330', 10);

app.listen(port, () => {
  console.log(`[youtube-api] listening on http://0.0.0.0:${port}`);
  console.log(`[youtube-api] output dir: ${process.env.YOUTUBE_OUTPUT_DIR || './output'}`);
});
