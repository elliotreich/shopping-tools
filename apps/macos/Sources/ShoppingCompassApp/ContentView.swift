import SwiftUI
import ShoppingCompassKit

struct ContentView: View {
    @State private var selectedList: ProductList?
    @State private var selectedProduct: Product?
    @State private var showSearch = false

    var body: some View {
        NavigationSplitView {
            ListsView(selectedList: $selectedList, selectedProduct: $selectedProduct, showSearch: $showSearch)
        } content: {
            if let list = selectedList {
                ListDetailView(list: list, selectedProduct: $selectedProduct)
            } else {
                ContentPlaceholder(text: "Select a list")
            }
        } detail: {
            if let product = selectedProduct {
                ProductDetailView(product: product)
            } else {
                ContentPlaceholder(text: "Select a product")
            }
        }
        .sheet(isPresented: $showSearch) {
            SearchView(selectedProduct: $selectedProduct)
        }
    }
}

struct ContentPlaceholder: View {
    let text: String

    var body: some View {
        Text(text)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
