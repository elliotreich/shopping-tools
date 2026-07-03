import SwiftUI
import ShoppingCompassKit

struct SearchView: View {
    @Binding var selectedProduct: Product?
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var results: [Product] = []
    @State private var isLoading = false
    @State private var error: Error?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                TextField("Search products…", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit {
                        Task { await performSearch() }
                    }

                Button("Search") {
                    Task { await performSearch() }
                }
                .keyboardShortcut(.return)
                .disabled(query.trimmingCharacters(in: .whitespaces).isEmpty)

                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
            .padding()

            Divider()

            if isLoading {
                Spacer()
                ProgressView("Searching…")
                Spacer()
            } else if results.isEmpty && !query.isEmpty {
                Spacer()
                ContentUnavailableView(
                    "No Results",
                    systemImage: "magnifyingglass",
                    description: Text("No products found for \"\(query)\".")
                )
                Spacer()
            } else if results.isEmpty {
                Spacer()
                ContentUnavailableView(
                    "Search Products",
                    systemImage: "magnifyingglass",
                    description: Text("Type a query above to search across all products.")
                )
                Spacer()
            } else {
                List(results) { product in
                    Button {
                        selectedProduct = product
                        dismiss()
                    } label: {
                        HStack(spacing: 12) {
                            AsyncImage(url: product.imageUrl.flatMap(URL.init)) { phase in
                                switch phase {
                                case .success(let image):
                                    image
                                        .resizable()
                                        .aspectRatio(contentMode: .fit)
                                        .frame(width: 48, height: 48)
                                        .cornerRadius(6)
                                default:
                                    Rectangle()
                                        .fill(.quaternary)
                                        .frame(width: 48, height: 48)
                                        .cornerRadius(6)
                                        .overlay {
                                            Image(systemName: "photo")
                                                .foregroundStyle(.secondary)
                                        }
                                }
                            }

                            VStack(alignment: .leading, spacing: 2) {
                                Text(product.title)
                                    .lineLimit(1)
                                    .fontWeight(.medium)

                                if let brand = product.brand {
                                    Text(brand)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }

                            Spacer()

                            if let price = product.price {
                                Text(price, format: .currency(code: "USD"))
                                    .fontWeight(.semibold)
                                    .monospacedDigit()
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
                .listStyle(.plain)
            }
        }
        .frame(width: 500, height: 400)
        .onChange(of: query) { _, newValue in
            guard !newValue.trimmingCharacters(in: .whitespaces).isEmpty else {
                results = []
                return
            }
            // Debounced search
            Task {
                try? await Task.sleep(nanoseconds: 300_000_000) // 300ms
                guard query == newValue else { return }
                await performSearch()
            }
        }
        .alert("Error", isPresented: .constant(error != nil), presenting: error) { _ in
            Button("OK") { error = nil }
        } message: { error in
            Text(error.localizedDescription)
        }
    }

    private func performSearch() async {
        let term = query.trimmingCharacters(in: .whitespaces)
        guard !term.isEmpty else { return }

        isLoading = true
        defer { isLoading = false }
        do {
            results = try await APIClient.shared.search(query: term)
        } catch {
            self.error = error
        }
    }
}
