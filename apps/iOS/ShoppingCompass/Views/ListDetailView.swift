import SwiftUI
import ShoppingCompassKit

// MARK: - ViewModel

@Observable
final class ListDetailViewModel {
    var listDetail: ListDetail?
    var isLoading = false
    var errorMessage: String?

    func loadListDetail(id: Int) async {
        isLoading = true
        errorMessage = nil
        do {
            listDetail = try await APIClient.shared.getListDetail(id: id)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - View

struct ListDetailView: View {
    let listId: Int

    @State private var viewModel = ListDetailViewModel()
    @State private var showingAddProduct = false
    @State private var showingSearch = false

    var body: some View {
        Group {
            if viewModel.isLoading && viewModel.listDetail == nil {
                ProgressView("Loading...")
            } else if let listDetail = viewModel.listDetail {
                if listDetail.items.isEmpty {
                    emptyState
                } else {
                    listContent(items: listDetail.items)
                }
            }
        }
        .navigationTitle(viewModel.listDetail?.name ?? "List")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.loadListDetail(id: listId)
        }
        .refreshable {
            await viewModel.loadListDetail(id: listId)
        }
        .alert("Error", isPresented: errorBinding) {
            Button("OK") { viewModel.errorMessage = nil }
        } message: {
            Text(viewModel.errorMessage ?? "Unknown error")
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    showingSearch = true
                } label: {
                    Image(systemName: "magnifyingglass")
                }
                Button {
                    showingAddProduct = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showingAddProduct) {
            AddProductView(listId: listId, onDismiss: {
                Task { await viewModel.loadListDetail(id: listId) }
            })
        }
        .sheet(isPresented: $showingSearch) {
            NavigationStack {
                SearchView(selectionCallback: { _ in
                    showingSearch = false
                    Task { await viewModel.loadListDetail(id: listId) }
                })
            }
        }
    }

    // MARK: - Subviews

    private var emptyState: some View {
        ContentUnavailableView {
            Label("Empty List", systemImage: "cart")
        } description: {
            Text("Add products to this list to get started.")
        } actions: {
            Button("Add Product") {
                showingAddProduct = true
            }
            Button("Search Products") {
                showingSearch = true
            }
        }
    }

    private func listContent(items: [ListItem]) -> some View {
        List(items, id: \.productId) { item in
            NavigationLink {
                ProductDetailView(productId: item.productId)
            } label: {
                itemRow(item)
            }
        }
    }

    private func itemRow(_ item: ListItem) -> some View {
        HStack(spacing: 12) {
            productThumbnail(url: item.imageUrl)

            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.headline)
                    .lineLimit(2)
                if let brand = item.brand {
                    Text(brand)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if let price = item.price {
                Text(price, format: .currency(code: "USD"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private func productThumbnail(url: String?) -> some View {
        AsyncImage(url: url.flatMap { URL(string: $0) }) { phase in
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
        ListDetailView(listId: 1)
    }
}
