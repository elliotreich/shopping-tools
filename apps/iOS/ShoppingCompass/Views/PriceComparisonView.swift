import SwiftUI
import ShoppingCompassKit

/// A compact list of store prices for a product.
/// Designed to be embedded inside a ScrollView or List.
struct PriceComparisonView: View {
    let listings: [ProductListing]

    var body: some View {
        ForEach(sortedListings, id: \.storeSlug) { listing in
            row(listing)
            if listing.storeSlug != sortedListings.last?.storeSlug {
                Divider()
            }
        }
    }

    private var sortedListings: [ProductListing] {
        listings.sorted { lhs, rhs in
            switch (lhs.price, rhs.price) {
            case (.some(let lp), .some(let rp)):
                return lp < rp
            case (.some, .none):
                return true
            case (.none, .some):
                return false
            case (.none, .none):
                return lhs.store < rhs.store
            }
        }
    }

    private func row(_ listing: ProductListing) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(listing.store)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                if let lastFetched = listing.lastFetched {
                    Text("Updated: \(formattedDate(lastFetched))")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                if let price = listing.price {
                    Text(price, format: .currency(code: "USD"))
                        .font(.body)
                        .fontWeight(.bold)
                        .monospacedDigit()
                } else {
                    Text("—")
                        .foregroundStyle(.secondary)
                }

                availabilityBadge(listing: listing)
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 16)
        .background(listing.available ? .clear : .secondary.opacity(0.05))
    }

    @ViewBuilder
    private func availabilityBadge(listing: ProductListing) -> some View {
        if listing.available {
            HStack(spacing: 4) {
                if listing.inStorePickup {
                    label(icon: "bag", text: "Pickup")
                }
                if listing.shippingEligible {
                    label(icon: "shippingbox", text: "Ship")
                }
                if !listing.inStorePickup && !listing.shippingEligible {
                    Text("In Stock")
                        .font(.caption2)
                        .foregroundStyle(.green)
                }
            }
        } else {
            Text("Unavailable")
                .font(.caption2)
                .foregroundStyle(.red)
        }
    }

    private func label(icon: String, text: String) -> some View {
        HStack(spacing: 2) {
            Image(systemName: icon)
                .font(.caption2)
            Text(text)
                .font(.caption2)
        }
        .foregroundStyle(.green)
    }

    private func formattedDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) {
            let relative = RelativeDateTimeFormatter()
            relative.unitsStyle = .abbreviated
            return relative.localizedString(for: date, relativeTo: Date())
        }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: iso) {
            let relative = RelativeDateTimeFormatter()
            relative.unitsStyle = .abbreviated
            return relative.localizedString(for: date, relativeTo: Date())
        }
        return iso
    }
}

#Preview {
    List {
        PriceComparisonView(listings: [
            ProductListing(
                store: "Amazon",
                storeSlug: "amazon",
                price: 29.99,
                inStorePickup: false,
                shippingEligible: true,
                available: true,
                lastFetched: "2026-06-09T12:00:00Z"
            ),
            ProductListing(
                store: "Walmart",
                storeSlug: "walmart",
                price: 27.49,
                inStorePickup: true,
                shippingEligible: true,
                available: true,
                lastFetched: "2026-06-09T11:30:00Z"
            ),
            ProductListing(
                store: "Target",
                storeSlug: "target",
                price: nil,
                inStorePickup: false,
                shippingEligible: false,
                available: false,
                lastFetched: "2026-06-08T09:00:00Z"
            ),
        ])
    }
    .listStyle(.plain)
}
