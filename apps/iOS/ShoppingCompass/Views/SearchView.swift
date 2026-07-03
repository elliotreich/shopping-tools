import SwiftUI
import ShoppingCompassKit

// MARK: - ViewModel

@Observable
final class SearchViewModel {
    var query = ""
    var results: [Product] = []
    var isSearching = false
    var errorMessage: String?

    func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            results = []
            return
        }

        isSearching = true
        errorMessage = nil
        do {
            results = try await APIClient.shared.search(query: trimmed)
        } catch {
            errorMessage = error.localizedDescription
        }
        isSearching = false
    }
}

// MARK: - View

struct SearchView: View {
    /// Optional callback invoked when a product is selected.
    var selectionCallback: ((Product) -> Void)?

    @State private var viewModel = SearchViewModel()

    var body: some View {
        listContent
            .navigationTitle("Search")
            .searchable(text: $viewModel.query)
            .autocorrectionDisabled()
            .onSubmit(of: .search) {
                Task { await viewModel.search() }
            }
            .task(id: viewModel.query) {
                guard !viewModel.query.trimmingCharacters(in: .whitespaces).isEmpty else {
                    viewModel.results = []
                    return
                }
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                await viewModel.search()
            }
            .alert("Error", isPresented: errorBinding) {
                Button("OK") { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "Unknown error")
            }
    }

    // MARK: - Subviews

    @ViewBuilder
    private var listContent: some View {
        if viewModel.isSearching && viewModel.results.isEmpty {
            VStack {
                ProgressView("Searching...")
            }
            .frame(maxWidth: .infinity, minHeight: 200)
        } else if viewModel.results.isEmpty && !viewModel.query.isEmpty {
            ContentUnavailableView {
                Label("No Results", systemImage: "magnifyingglass")
            } description: {
                Text("Try a different search term.")
            }
        } else {
            List {
                ForEach(viewModel.results) { product in
                    if let selectionCallback {
                        Button {
                            selectionCallback(product)
                        } label: {
                            productRow(product)
                        }
                        .buttonStyle(.plain)
                    } else {
                        NavigationLink {
                            ProductDetailView(productId: product.id)
                        } label: {
                            productRow(product)
                        }
                    }
                }
            }
            .listStyle(.plain)
        }
    }

    private func productRow(_ product: Product) -> some View {
        HStack(spacing: 12) {
            AsyncImage(url: product.imageUrl.flatMap { URL(string: $0) }) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 60, height: 60)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                case .failure:
                    Image(systemName: "photo")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                        .frame(width: 60, height: 60)
                        .background(.quaternary)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                case .empty:
                    ProgressView()
                        .frame(width: 60, height: 60)
                @unknown default:
                    EmptyView()
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(product.title)
                    .font(.headline)
                    .lineLimit(2)
                if let brand = product.brand {
                    Text(brand)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if let price = product.price {
                Text(price, format: .currency(code: "USD"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
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
    NavigationStack {
        SearchView()
    }
}
