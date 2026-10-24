cask "ordo" do
  version "0.1.5"
  sha256 "50af644920c8c486269c8a13b324e99246eb36e0f1eae936a0a4f114425a0553"

  url "https://raw.githubusercontent.com/Kontaa5/Ordo/releases/Ordo-#{version}.zip"
  name "Ordo"
  desc "Markdown-Notizen wie Obsidian, mit Hashtag-Ordnern und PDF-Export"
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
