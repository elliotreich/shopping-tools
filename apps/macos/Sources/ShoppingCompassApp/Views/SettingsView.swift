import SwiftUI
import ShoppingCompassKit

struct SettingsView: View {
    @State private var stores: [Store] = []
    @State private var isLoading = true
    @State private var error: Error?

    var body: some View {
        Form {
            Section("Stores") {
                if isLoading {
                    ProgressView()
                } else {
                    List(stores) { store in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(store.name)
                                    .fontWeight(.medium)
                                if let baseURL = store.baseUrl {
                                    Text(baseURL)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }

                            Spacer()

                            Toggle("Enabled", isOn: Binding(
                                get: { store.active },
                                set: { newValue in
                                    toggleStore(store, active: newValue)
                                }
                            ))
                            .labelsHidden()
                        }
                    }
                }
            }

            Section("About") {
                HStack {
                    Text("Shopping Compass")
                    Spacer()
                    Text("1.0")
                        .foregroundStyle(.secondary)
                }

                HStack {
                    Text("Backend")
                    Spacer()
                    Text("Tailscale (100.121.190.104:8091)")
                        .foregroundStyle(.secondary)
                        .font(.caption)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
        .task {
            await loadStores()
        }
        .alert("Error", isPresented: .constant(error != nil), presenting: error) { _ in
            Button("OK") { error = nil }
        } message: { error in
            Text(error.localizedDescription)
        }
    }

    private func loadStores() async {
        isLoading = true
        defer { isLoading = false }
        do {
            stores = try await APIClient.shared.getStores()
        } catch {
            self.error = error
        }
    }

    private func toggleStore(_ store: Store, active: Bool) {
        // The backend currently doesn't expose a toggle endpoint via the shared kit.
        // This state update is optimistic — stored locally for the UI toggle.
        // A future update will wire this to a PATCH /stores/:id endpoint.
        if let index = stores.firstIndex(where: { $0.id == store.id }) {
            stores[index] = Store(
                id: store.id,
                name: store.name,
                slug: store.slug,
                active: active,
                baseUrl: store.baseUrl
            )
        }
    }
}
