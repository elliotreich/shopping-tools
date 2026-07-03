import SwiftUI
import ShoppingCompassKit

struct ProductDetailView: View {
    let product: Product

    @State private var detail: ProductDetail?
    @State private var isLoading = true
    @State private var isScanning = false
    @State private var error: Error?

    var body: some View {
        ScrollView {
            if isLoading {
                ProgressView()
                    .padding(.top, 60)
            } else if let detail {
                VStack(alignment: .leading, spacing: 24) {
                    headerSection(detail: detail)
                    priceComparisonTable(listings: detail.listings)
                    pendingMatchesSection(matches: detail.pendingMatches)
                    actionButtons
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .navigationTitle(product.title)
        .task(id: product.id) {
            await loadDetail()
        }
        .alert("Error", isPresented: .constant(error != nil), presenting: error) { _ in
            Button("OK") { error = nil }
        } message: { error in
            Text(error.localizedDescription)
        }
    }

    // MARK: - Header

    private func headerSection(detail: ProductDetail) -> some View {
        HStack(alignment: .top, spacing: 20) {
            AsyncImage(url: detail.imageUrl.flatMap(URL.init)) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 180, height: 180)
                        .cornerRadius(12)
                case .failure:
                    Rectangle()
                        .fill(.quaternary)
                        .frame(width: 180, height: 180)
                        .cornerRadius(12)
                        .overlay {
                            Image(systemName: "photo")
                                .foregroundStyle(.secondary)
                        }
                case .empty:
                    Rectangle()
                        .fill(.quaternary)
                        .frame(width: 180, height: 180)
                        .cornerRadius(12)
                        .overlay {
                            ProgressView()
                        }
                @unknown default:
                    EmptyView()
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(detail.title)
                    .font(.title2)
                    .fontWeight(.bold)

                if let brand = detail.brand {
                    Label(brand, systemImage: "tag")
                        .foregroundStyle(.secondary)
                }

                if let description = detail.description {
                    Text(description)
                        .font(.body)
                        .foregroundStyle(.secondary)
                }

                if let notes = detail.notes {
                    Text(notes)
                        .font(.callout)
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }

    // MARK: - Price Comparison Table

    private func priceComparisonTable(listings: [ProductListing]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Price Comparison")
                .font(.headline)

            if listings.isEmpty {
                Text("No store data yet. Tap 'Scan All Stores' to check prices.")
                    .foregroundStyle(.secondary)
                    .font(.callout)
            } else {
                VStack(spacing: 0) {
                    // Header row
                    HStack {
                        Text("Store").frame(width: 120, alignment: .leading)
                        Text("Price").frame(width: 80, alignment: .trailing)
                        Text("Available").frame(width: 70, alignment: .center)
                        Text("Shipping").frame(width: 70, alignment: .center)
                        Spacer()
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 4)

                    Divider()

                    ForEach(listings, id: \.storeSlug) { listing in
                        HStack {
                            Text(listing.store)
                                .frame(width: 120, alignment: .leading)
                                .fontWeight(.medium)

                            if let price = listing.price {
                                Text(price, format: .currency(code: "USD"))
                                    .frame(width: 80, alignment: .trailing)
                                    .fontWeight(.semibold)
                            } else {
                                Text("—")
                                    .frame(width: 80, alignment: .trailing)
                                    .foregroundStyle(.secondary)
                            }

                            Image(systemName: listing.available ? "checkmark.circle.fill" : "xmark.circle")
                                .foregroundStyle(listing.available ? .green : .secondary)
                                .frame(width: 70, alignment: .center)

                            Image(systemName: listing.shippingEligible ? "shippingbox.fill" : "shippingbox")
                                .foregroundStyle(listing.shippingEligible ? .blue : .secondary)
                                .frame(width: 70, alignment: .center)

                            Spacer()

                            if let url = listing.url, let link = URL(string: url) {
                                Link(destination: link) {
                                    Label("Open", systemImage: "arrow.up.right.square")
                                        .labelStyle(.iconOnly)
                                }
                                .buttonStyle(.plain)
                                .help(url)
                            }
                        }
                        .padding(.vertical, 6)

                        Divider()
                    }
                }
                .background(Color(nsColor: .controlBackgroundColor))
                .cornerRadius(8)
            }
        }
    }

    // MARK: - Pending Matches

    private func pendingMatchesSection(matches: [PendingMatch]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if !matches.isEmpty {
                Text("Pending Match Suggestions")
                    .font(.headline)

                ForEach(matches, id: \.id) { match in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(match.storeName ?? "Unknown Store")
                                .fontWeight(.medium)
                            if let price = match.price {
                                Text(price, format: .currency(code: "USD"))
                                    .foregroundStyle(.secondary)
                            }
                        }

                        Spacer()

                        HStack(spacing: 12) {
                            Button {
                                confirmMatch(match)
                            } label: {
                                Label("Confirm", systemImage: "checkmark.circle")
                                    .foregroundStyle(.green)
                            }
                            .buttonStyle(.plain)

                            Button {
                                rejectMatch(match)
                            } label: {
                                Label("Reject", systemImage: "xmark.circle")
                                    .foregroundStyle(.red)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(8)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .cornerRadius(8)
                }
            }
        }
    }

    // MARK: - Actions

    private var actionButtons: some View {
        HStack(spacing: 16) {
            Button {
                Task { await scan() }
            } label: {
                if isScanning {
                    ProgressView()
                        .scaleEffect(0.8)
                } else {
                    Label("Scan All Stores", systemImage: "arrow.triangle.2.circlepath")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isScanning)

            Button("Search Matches") {
                // Cross-store matching is triggered server-side via scan.
                // This button can be used to re-trigger the matcher explicitly.
                Task { await scan() }
            }
            .buttonStyle(.bordered)
        }
    }

    // MARK: - Actions

    private func loadDetail() async {
        isLoading = true
        defer { isLoading = false }
        do {
            detail = try await APIClient.shared.getProductDetail(id: product.id)
        } catch {
            self.error = error
        }
    }

    private func scan() async {
        isScanning = true
        defer { isScanning = false }
        do {
            _ = try await APIClient.shared.scanProduct(productId: product.id)
            // Reload detail to show updated listings and pending matches
            detail = try await APIClient.shared.getProductDetail(id: product.id)
        } catch {
            self.error = error
        }
    }

    private func confirmMatch(_ match: PendingMatch) {
        Task {
            do {
                try await APIClient.shared.updateMatch(suggestionId: match.id, status: "confirmed")
                // Reload to remove the confirmed match from pending
                detail = try await APIClient.shared.getProductDetail(id: product.id)
            } catch {
                self.error = error
            }
        }
    }

    private func rejectMatch(_ match: PendingMatch) {
        Task {
            do {
                try await APIClient.shared.updateMatch(suggestionId: match.id, status: "rejected")
                detail = try await APIClient.shared.getProductDetail(id: product.id)
            } catch {
                self.error = error
            }
        }
    }
}
