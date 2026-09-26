const fs = require("fs");
const path = require("path");

const PLUGINS_DIR = path.join(__dirname, "..", "Plugins");
const OUTPUT_FILE = path.join(__dirname, "..", "manifest.json");

function parseHeader(code, fallbackId) {
  const meta = {
    id: fallbackId,
    name: fallbackId,
    description: "",
    author: "",
    version: "1.0.0"
  };

  const headerMatch = code.match(/\/\*\*([\s\S]*?)\*\//);
  if (!headerMatch) return meta;

  const block = headerMatch[1];
  const grab = (tag) => {
    const m = block.match(new RegExp(`@${tag}\\s+(.+)`));
    return m ? m[1].trim() : "";
  };

  meta.name = grab("name") || fallbackId;
  meta.description = grab("description");
  meta.author = grab("author");
  meta.version = grab("version") || "1.0.0";
  return meta;
}

function main() {
  if (!fs.existsSync(PLUGINS_DIR)) {
    console.error(`Plugins folder not found at ${PLUGINS_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(PLUGINS_DIR)
    .filter((f) => f.endsWith(".js"))
    .sort();

  const plugins = files.map((file) => {
    const fullPath = path.join(PLUGINS_DIR, file);
    const code = fs.readFileSync(fullPath, "utf8");
    const fallbackId = file.replace(/\.js$/, "");
    const meta = parseHeader(code, fallbackId);

    return {
      id: meta.id,
      name: meta.name,
      description: meta.description,
      author: meta.author,
      version: meta.version,
      file: `Plugins/${file}`
    };
  });

  const manifest = {
    repoName: "IronWeb10 Plugins",
    generatedAt: new Date().toISOString(),
    plugins
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Generated with ${plugins.length} plugin(s):`);
  for (const p of plugins) {
    console.log(`   - ${p.name} (${p.id}) v${p.version} by ${p.author || "unknown"}`);
  }
}

main();
