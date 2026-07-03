import SwiftUI
import ShoppingCompassKit

struct ListDetailView: View {
    let list: ProductList
    @Binding var selectedProduct: Product?

    @State private var products: [Product] = []
    @State private var isLoading = true
    @State private var error: Error?
    @State private var showAddProduct = false
    @State private var showSearch = false

    private let columns = [GridItem(.adaptive(minimum: 280, maximum: 320), spacing: 16)]

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if products.isEmpty {
                ContentUnavailableView(
                    "No products",
                    systemImage: "cart",
                    description: Text("Add a product or search to get started.")
                )
            } else {
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 16) {
                        ForEach(products) { product in
                            ProductCard(product: product)
                                .onTapGesture {
                                    selectedProduct = product
                                }
                        }
                    }
                    .padding()
                }
            }
        }
        .navigationTitle(list.name)
        .toolbar {
            ToolbarItemGroup {
                Button {
                    showSearch = true
                } label: {
                    Label("Search", systemImage: "magnifyingglass")
                }

                Button {
                    showAddProduct = true
                } label: {
                    Label("Add Product", systemImage: "plus")
                }
            }
        }
        .task(id: list.id) {
            await loadProducts()
        }
        .refreshable {
            await loadProducts()
        }
        .sheet(isPresented: $showAddProduct) {
            AddProductView(listId: list.id)
        }
        .sheet(isPresented: $showSearch) {
            SearchView(selectedProduct: $selectedProduct)
        }
        .alert("Error", isPresented: .constant(error != nil), presenting: error) { _ in
            Button("OK") { error = nil }
        } message: { error in
            Text(error.localizedDescription)
        }
    }

    private func loadProducts() async {
        isLoading = true
        defer { isLoading = false }
        do {
            products = try await APIClient.shared.getProducts(listId: list.id)
        } catch {
            self.error = error
        }
    }
}

// MARK: - ProductCard

struct ProductCard: View {
    let product: Product

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            AsyncImage(url: product.imageUrl.flatMap(URL.init)) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(height: 140)
                        .frame(maxWidth: .infinity)
                case .failure:
                    Rectangle()
                        .fill(.quaternary)
                        .frame(height: 140)
                        .overlay {
                            Image(systemName: "photo")
                                .foregroundStyle(.secondary)
                        }
                case .empty:
                    Rectangle()
                        .fill(.quaternary)
                        .frame(height: 140)
                        .overlay {
                            ProgressView()
                        }
                @unknown default:
                    EmptyView()
                }
            }
            .cornerRadius(8)

            VStack(alignment: .leading, spacing: 2) {
                Text(product.title)
                    .lineLimit(2)
                    .fontWeight(.medium)

                if let brand = product.brand {
                    Text(brand)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let price = product.price {
                    Text(price, format: .currency(code: "USD"))
                        .fontWeight(.semibold)
                        .foregroundStyle(.primary)
                }
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 8)
        }
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.06), radius: 4, y: 2)
    }
}
