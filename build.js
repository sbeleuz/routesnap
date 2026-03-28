const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Directories
const sourceDir = path.join(__dirname, "src");
const publicDir = path.join(__dirname, "public");
const distDir = path.join(__dirname, "dist");

/**
 * Recursively copy a directory and all its contents
 */
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  entries.forEach((entry) => {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  ✓ ${path.relative(__dirname, destPath)}`);
    }
  });
}

/**
 * Generate PNG icons from SVG sources using sips (built-in macOS tool).
 *
 * SVGs are the canonical source — PNGs are build artifacts emitted directly
 * into dist/icons/ so the source tree is never modified by the build.
 * Chrome extensions only support raster (PNG) icons; SVGs are silently
 * ignored and the browser falls back to the default puzzle-piece icon.
 *
 * sips is available on every macOS installation.  On other platforms
 * (Linux/Windows CI) install ImageMagick and this function will fall back
 * to `convert`, or skip with a warning if neither is available.
 *
 * @param {string} destIconsDir - Output directory for generated PNGs (e.g. dist/icons/).
 */
function generatePngIcons(destIconsDir) {
  const iconsDir = path.join(publicDir, "icons");
  const sizes = [16, 48, 128];

  // Detect the conversion tool once.
  let tool = null;
  try {
    execSync("which sips", { stdio: "ignore" });
    tool = "sips";
  } catch (_) {}
  if (!tool) {
    try {
      execSync("which convert", { stdio: "ignore" });
      tool = "convert";
    } catch (_) {}
  }

  if (!tool) {
    console.warn(
      "⚠️  No SVG→PNG conversion tool found (sips or ImageMagick convert).\n" +
        "   Icons will be missing — install ImageMagick or run on macOS.",
    );
    return;
  }

  console.log(`\n🖼️  Generating PNG icons (via ${tool})...`);

  sizes.forEach((size) => {
    const svgPath = path.join(iconsDir, `icon-${size}.svg`);
    const pngPath = path.join(destIconsDir, `icon-${size}.png`);

    if (!fs.existsSync(svgPath)) {
      console.warn(`  ⚠️  SVG source not found: ${svgPath}`);
      return;
    }

    try {
      if (tool === "sips") {
        execSync(
          `sips -s format png -z ${size} ${size} "${svgPath}" --out "${pngPath}"`,
          { stdio: "ignore" },
        );
      } else {
        // ImageMagick fallback
        execSync(
          `convert -background none -resize ${size}x${size} "${svgPath}" "${pngPath}"`,
          { stdio: "ignore" },
        );
      }
      console.log(`  ✓ icon-${size}.png`);
    } catch (err) {
      console.error(`  ✗ Failed to generate icon-${size}.png:`, err.message);
    }
  });
}

/**
 * Main build process
 */
function build() {
  console.log("🔨 Building extension to dist/...\n");

  // Clean dist directory if it exists
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
    console.log("🗑️  Cleaned dist/ directory\n");
  }

  // Create fresh dist directory
  fs.mkdirSync(distDir, { recursive: true });

  // Copy public files (manifest.json, icons, etc.) first so the dist/icons/
  // directory exists before we generate PNGs into it.
  console.log("\n📋 Copying public files (manifest, icons)...");
  copyDir(publicDir, distDir);

  // Generate PNG icons from SVG sources directly into dist/icons/ so that
  // build artifacts never land in the source tree.
  generatePngIcons(path.join(distDir, "icons"));

  // Copy source files (background, content, popup)
  console.log("\n📝 Copying source files...");
  copyDir(sourceDir, distDir);

  console.log("\n✅ Build complete!");
  console.log("\n📍 Next step: Load dist/ folder in chrome://extensions/\n");
}

// Run build
try {
  build();
} catch (error) {
  console.error("❌ Build failed:", error.message);
  process.exit(1);
}
