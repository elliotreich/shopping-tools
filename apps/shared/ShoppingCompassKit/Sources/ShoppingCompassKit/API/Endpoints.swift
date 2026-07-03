import Foundation

/// Internal path helpers for constructing API endpoint URLs.
/// All paths are relative to the base API URL.
enum Endpoints {
    // MARK: - Lists
    static let lists = "/lists"

    static func listDetail(id: Int) -> String {
        "/lists/\(id)"
    }

    // MARK: - Products
    static let products = "/products"

    static func productDetail(id: Int) -> String {
        "/products/\(id)"
    }

    static func productPrices(id: Int) -> String {
        "/products/\(id)/prices"
    }

    // MARK: - Search
    static let search = "/search"

    // MARK: - Stores
    static let stores = "/stores"

    // MARK: - Scrape
    static func scanProduct(productId: Int) -> String {
        "/scan/\(productId)"
    }

    static let scanURL = "/scan-url"

    // MARK: - Matches
    static let matches = "/matches"
}
