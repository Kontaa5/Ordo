cask "ordo" do
  version "0.1.11"
  sha256 "1fbc0db9a04ebe38763492bd663fa88053dfbf0855383cc46459dd8950c6fc5e"

  url "https://raw.githubusercontent.com/Kontaa5/Ordo/releases/Ordo-#{version}.zip"
  name "Ordo"
  desc "Markdown-Editor mit Hashtag-Ordnern und PDF-Export"
  homepage "https://github.com/Kontaa5/Ordo"

  depends_on macos: :sonoma

  app "Ordo.app"

  # Ordo ist nicht von Apple notarisiert (kostenloser Entwickler-Account):
  # ohne diesen Schritt würde macOS das Öffnen blockieren.
  postflight_steps do
    run "/usr/bin/xattr",
        args:           ["-dr", "com.apple.quarantine", "{{appdir}}/Ordo.app"],
        writable_paths: ["Ordo.app"],
        writable_base:  :appdir
  end

  zap trash: [
    "~/Library/Application Support/Ordo",
    "~/Library/Preferences/at.ordo.notes.plist",
    "~/Library/Caches/at.ordo.notes",
  ]
end
