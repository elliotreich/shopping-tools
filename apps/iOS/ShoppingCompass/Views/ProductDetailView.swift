import SwiftUI
import ShoppingCompassKit

// MARK: - ViewModel

@Observable
final class ProductDetailViewModel {
    var productDetail: ProductDetail?
    var isLoading = false
    var isScanning = false
    var errorMessage: String?

    func loadProductDetail(id: Int) async {
        isLoading = true
        errorMessage = nil
        do {
            productDetail = try await APIClient.shared.getProductDetail(id: id)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func scanProduct(id: Int) async {
        isScanning = true
        errorMessage = nil
        do {
            try await APIClient.shared.scanProduct(productId: id)
            await loadProductDetail(id: id)
        } catch {
            errorMessage = error.localizedDescription
        }
        isScanning = false
    }
}

// MARK: - View

struct ProductDetailView: View {
    let productId: Int

    @State private var viewModel = ProductDetailViewModel()

    var body: some View {
        Group {
            if viewModel.isLoading && viewModel.productDetail == nil {
                ProgressView("Loading product...")
            } else if let detail = viewModel.productDetail {
                content(detail: detail)
            }
        }
        .navigationTitle("Product")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.loadProductDetail(id: productId)
        }
        .alert("Error", isPresented: errorBinding) {
            Button("OK") { viewModel.errorMessage = nil }
        } message: {
            Text(viewModel.errorMessage ?? "Unknown error")
        }
    }

    // MARK: - Content

    private func content(detail: ProductDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                productImage(url: detail.imageUrl)

                VStack(alignment: .leading, spacing: 4) {
                    Text(detail.title)
                        .font(.title2)
                        .bold()
                    if let brand = detail.brand {
                        Text(brand)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    if let description = detail.description {
                        Text(description)
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .padding(.top, 4)
                    }
                }
                .padding(.horizontal)

                if !detail.listings.isEmpty {
                    priceComparisonSection(listings: detail.listings)
                } else {
                    noPricesState
                }

                scanButton
                    .padding(.horizontal)
                    .padding(.bottom)
            }
        }
    }

    // MARK: - Subviews

    private func productImage(url: String?) -> some View {
        AsyncImage(url: url.flatMap { URL(string: $0) }) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: .infinity)
            case .failure:
                placeholderImage
            case .empty:
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 200)
            @unknown default:
                placeholderImage
            }
        }
    }

    private var placeholderImage: some View {
        Image(systemName: "photo")
            .font(.system(size: 60))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 200)
            .background(.quaternary)
    }

    private func priceComparisonSection(listings: [ProductListing]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Price Comparison")
                .font(.headline)
                .padding(.horizontal)

            VStack(spacing: 0) {
                PriceComparisonView(listings: listings)
            }
            .background(.background)
                .padding(.horizontal)
        }
    }

    private var noPricesState: some View {
        ContentUnavailableView {
            Label("No Prices Yet", systemImage: "dollarsign.circle")
        } description: {
            Text("Tap 'Scan All Stores' to check prices.")
        }
    }

    private var scanButton: some View {
        Button {
            Task { await viewModel.scanProduct(id: productId) }
        } label: {
            HStack {
                if viewModel.isScanning {
                    ProgressView()
                        .tint(.white)
                    Text("Scanning...")
                } else {
                    Image(systemName: "antenna.radiowaves.left.and.right")
                    Text("Scan All Stores")
                }
            }
            .frame(maxWidth: .infinity)
            .padding()
            .background(.blue)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(viewModel.isScanning)
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
        ProductDetailView(productId: 1)
    }
}
