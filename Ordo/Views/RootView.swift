import SwiftUI
import PhotosUI

/// The whole interface is drawn by the web shell; SwiftUI only hosts it and
/// presents the native pickers it asks for.
struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        WebViewHost(webView: model.shell.webView)
            .ignoresSafeArea()
            #if os(iOS)
            .fileImporter(isPresented: $model.showFolderPicker, allowedContentTypes: [.folder]) { result in
                if case .success(let url) = result {
                    _ = url.startAccessingSecurityScopedResource()
                    model.openVault(url)
                }
            }
            .photosPicker(isPresented: $model.showPhotoPicker, selection: $model.photoSelection, maxSelectionCount: 20, matching: .images)
            .onChange(of: model.photoSelection) { _, items in model.photoPickerChanged(items) }
            .onChange(of: model.showPhotoPicker) { _, shown in if !shown { model.photoPickerDismissed() } }
            .sheet(isPresented: Binding(get: { !model.shareURLs.isEmpty }, set: { if !$0 { model.shareURLs = [] } })) {
                ShareSheet(urls: model.shareURLs).presentationDetents([.medium, .large])
            }
            #endif
    }
}

#if os(iOS)
struct ShareSheet: UIViewControllerRepresentable {
    let urls: [URL]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: urls, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
#endif
