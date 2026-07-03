import SwiftUI
import ShoppingCompassKit

// MARK: - ViewModel

@Observable
final class SettingsViewModel {
    var stores: [Store] = []
    var isLoading = false
    var errorMessage: String?

    /// Persisted set of store IDs the user has enabled for comparison.
    private var enabledStoreIds: Set<Int> {
        get { Set(UserDefaults.standard.array(forKey: Self.enabledKey) as? [Int] ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: Self.enabledKey) }
    }

    func isStoreEnabled(_ store: Store) -> Bool {
        enabledStoreIds.contains(store.id)
    }

    func toggleStore(_ store: Store) {
        if enabledStoreIds.contains(store.id) {
            enabledStoreIds.remove(store.id)
        } else {
            enabledStoreIds.insert(store.id)
        }
    }

    func loadStores() async {
        isLoading = true
        errorMessage = nil
        do {
            stores = try await APIClient.shared.getStores()
            // Seed enabled set from active stores on first launch.
            if UserDefaults.standard.array(forKey: Self.enabledKey) == nil {
                enabledStoreIds = Set(stores.filter(\.active).map(\.id))
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    }

    var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }

    private static let enabledKey = "enabledStoreIds"
}

// MARK: - View

struct SettingsView: View {
    @State private var viewModel = SettingsViewModel()

    var body: some View {
        NavigationStack {
            Form {
                storesSection
                infoSection
            }
            .navigationTitle("Settings")
            .task {
                await viewModel.loadStores()
            }
            .refreshable {
                await viewModel.loadStores()
            }
            .alert("Error", isPresented: errorBinding) {
                Button("OK") { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "Unknown error")
            }
        }
    }

    // MARK: - Sections

    private var storesSection: some View {
        Section {
            if viewModel.isLoading && viewModel.stores.isEmpty {
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
            } else if viewModel.stores.isEmpty {
                Text("No stores available.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(viewModel.stores) { store in
                    Toggle(isOn: Binding(
                        get: { viewModel.isStoreEnabled(store) },
                        set: { _ in viewModel.toggleStore(store) }
                    )) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(store.name)
                                .font(.body)
                            if let baseURL = store.baseUrl {
                                Text(baseURL)
                                    .font(.caption)
                                    .foregroundStyle(.tertiary)
                                    .lineLimit(1)
                            }
                        }
                    }
                }
            }
        } header: {
            Text("Stores")
        } footer: {
            Text("Enable or disable stores for price comparison searches.")
        }
    }

    private var infoSection: some View {
        Section {
            HStack {
                Text("Version")
                Spacer()
                Text("\(viewModel.appVersion) (\(viewModel.buildNumber))")
                    .foregroundStyle(.secondary)
            }
            HStack {
                Text("API Server")
                Spacer()
                Text("Tailscale")
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("About")
        }
    }

    // MARK: - Helpers

    private var errorBinding: Binding<Bool> {
        Binding(
            get: { viewModel.errorMessage != nil },
            set: { if !$0 { viewModel.errorMessage = nil } }
        )
    }
}

#Preview {
    SettingsView()
}
