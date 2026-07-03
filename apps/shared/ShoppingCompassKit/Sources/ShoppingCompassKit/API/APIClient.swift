import Foundation

/// Errors that can occur during API communication.
public enum APIClientError: Error, LocalizedError, Sendable {
    case invalidURL
    case httpError(Int)
    case decodingError(Error)
    case networkError(Error)

    public var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "The request URL could not be constructed."
        case .httpError(let statusCode):
            return "HTTP error \(statusCode)."
        case .decodingError(let error):
            return "Failed to decode response: \(error.localizedDescription)"
        case .networkError(let error):
            return "Network request failed: \(error.localizedDescription)"
        }
    }
}

/// Result of scanning a single URL for product info.
public struct ScanResult: Codable, Sendable {
    public let storeId: Int?
    public let storeName: String?
    public let price: Double?
    public let available: Bool?
    public let url: String?
    public let error: String?

    public init(
        storeId: Int? = nil,
        storeName: String? = nil,
        price: Double? = nil,
        available: Bool? = nil,
        url: String? = nil,
        error: String? = nil
    ) {
        self.storeId = storeId
        self.storeName = storeName
        self.price = price
        self.available = available
        self.url = url
        self.error = error
    }

    private enum CodingKeys: String, CodingKey {
        case storeId = "store_id"
        case storeName = "store_name"
        case price
        case available
        case url
        case error
    }
}

// MARK: - APIClient

/// Actor-based HTTP client for the Shopping Compass backend API.
///
/// All requests are sent to `http://100.121.190.104:8091/api` with automatic
/// JSON encoding/decoding. Thread-safe by virtue of Swift actors.
public actor APIClient {
    public static let shared = APIClient()

    private let baseURL = "http://100.121.190.104:8091/api"
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60

        self.session = URLSession(configuration: config)

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        self.decoder = decoder

        self.encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
    }

    // MARK: - Lists

    /// Fetch all product lists.
    public func getLists() async throws -> [ProductList] {
        try await request(.GET, Endpoints.lists)
    }

    /// Fetch a single list with its items.
    public func getListDetail(id: Int) async throws -> ListDetail {
        try await request(.GET, Endpoints.listDetail(id: id))
    }

    /// Create a new product list. Returns the created list's ID.
    public func createList(name: String, source: String) async throws -> Int {
        let body: [String: String] = ["name": name, "source": source]
        let data = try encoder.encode(body)
        let response: CreateResponse = try await request(.POST, Endpoints.lists, body: data)
        return response.id
    }

    /// Delete a product list.
    public func deleteList(id: Int) async throws {
        let _: EmptyResponse = try await request(.DELETE, Endpoints.listDetail(id: id))
    }

    // MARK: - Products

    /// Fetch products, optionally filtered by list.
    public func getProducts(listId: Int? = nil) async throws -> [Product] {
        var path = Endpoints.products
        if let listId {
            path += "?list_id=\(listId)"
        }
        return try await request(.GET, path)
    }

    /// Fetch full product detail including listings and pending matches.
    public func getProductDetail(id: Int) async throws -> ProductDetail {
        try await request(.GET, Endpoints.productDetail(id: id))
    }

    /// Fetch price snapshots for a product.
    public func getProductPrices(id: Int) async throws -> [PriceSnapshot] {
        try await request(.GET, Endpoints.productPrices(id: id))
    }

    /// Create a new product. Returns the created product's ID.
    public func createProduct(
        title: String,
        brand: String? = nil,
        url: String? = nil,
        listId: Int? = nil
    ) async throws -> Int {
        var body: [String: AnyEncodable] = [
            "title": AnyEncodable(title),
        ]
        if let brand {
            body["brand"] = AnyEncodable(brand)
        }
        if let url {
            body["url"] = AnyEncodable(url)
        }
        if let listId {
            body["list_id"] = AnyEncodable(listId)
        }

        let data = try encoder.encode(AnyEncodable(body))
        let response: CreateResponse = try await request(.POST, Endpoints.products, body: data)
        return response.id
    }

    // MARK: - Search

    /// Search products by query, optionally scoped to specific stores.
    public func search(query: String, storeIds: [Int]? = nil) async throws -> [Product] {
        var path = "\(Endpoints.search)?q=\(query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query)"
        if let storeIds, !storeIds.isEmpty {
            let idsParam = storeIds.map(String.init).joined(separator: ",")
            path += "&store_ids=\(idsParam)"
        }
        return try await request(.GET, path)
    }

    // MARK: - Stores

    /// Fetch all active stores.
    public func getStores() async throws -> [Store] {
        try await request(.GET, Endpoints.stores)
    }

    // MARK: - Scrape

    /// Trigger a scan of all known URLs for a product.
    public func scanProduct(productId: Int) async throws -> [ScanResult] {
        try await request(.POST, Endpoints.scanProduct(productId: productId))
    }

    /// Scan a single arbitrary URL for product info.
    public func scanURL(url: String, storeId: Int? = nil) async throws -> ScanResult {
        var body: [String: AnyEncodable] = [
            "url": AnyEncodable(url),
        ]
        if let storeId {
            body["store_id"] = AnyEncodable(storeId)
        }
        let data = try encoder.encode(AnyEncodable(body))
        return try await request(.POST, Endpoints.scanURL, body: data)
    }

    // MARK: - Matches

    /// Accept or reject a pending match suggestion.
    public func updateMatch(suggestionId: Int, status: String) async throws {
        let body: [String: AnyEncodable] = [
            "suggestion_id": AnyEncodable(suggestionId),
            "status": AnyEncodable(status),
        ]
        let data = try encoder.encode(AnyEncodable(body))
        let _: EmptyResponse = try await request(.POST, Endpoints.matches, body: data)
    }

    // MARK: - Private Helpers

    /// Perform a request and decode the response body to the expected type.
    private func request<T: Decodable>(
        _ method: HTTPMethod,
        _ path: String,
        body: Data? = nil
    ) async throws -> T {
        let data = try await requestData(method, path, body: body)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIClientError.decodingError(error)
        }
    }

    /// Perform a request and return the raw response data.
    @discardableResult
    private func requestData(
        _ method: HTTPMethod,
        _ path: String,
        body: Data? = nil
    ) async throws -> Data {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw APIClientError.invalidURL
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method.rawValue
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")

        if let body {
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            urlRequest.httpBody = body
        }

        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: urlRequest)
        } catch {
            throw APIClientError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.networkError(URLError(.badServerResponse))
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIClientError.httpError(httpResponse.statusCode)
        }

        return data
    }
}

// MARK: - Internal Helpers

/// Simple HTTP method wrapper.
enum HTTPMethod: String, Sendable {
    case GET
    case POST
    case DELETE
    case PUT
    case PATCH
}

/// Lightweight type erasure so we can encode heterogeneous dictionaries.
struct AnyEncodable: Encodable {
    let value: Encodable

    init(_ value: Encodable) {
        self.value = value
    }

    func encode(to encoder: Encoder) throws {
        try value.encode(to: encoder)
    }
}

/// Minimal response shape for create endpoints returning `{ "id": ... }`.
struct CreateResponse: Decodable, Sendable {
    let id: Int
}

/// Used for endpoints that return an empty body on success.
struct EmptyResponse: Decodable, Sendable {}
