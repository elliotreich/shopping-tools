import Foundation

struct Retailer: Codable, Identifiable {
    let id: String
    let name: String
    let domain: String
    let membershipNote: String
}

struct RetailerResult: Codable, Identifiable {
    var id: String { url }
    let retailer: String
    let title: String
    let url: String
    let snippet: String
}

struct RetailerSearchBlock: Codable, Identifiable {
    var id: String { retailer }
    let retailer: String
    let name: String
    let domain: String
    let results: [RetailerResult]
    let error: String?
}

struct SearchResponse: Codable {
    let query: String
    let retailers: [RetailerSearchBlock]
    let errors: [String]
}

struct ResaleListing: Codable, Identifiable {
    let id: String
    let platform: String
    let title: String
    let url: String
    let price: Double?
    let score: Int?
    let brand: String?
    let firstSeen: String?
    let scoreJSON: String?
}

struct ResaleResponse: Codable {
    let listings: [ResaleListing]
    let count: Int
}

struct HealthResponse: Codable {
    let status: String
}

enum AppConfig {
    static let defaultAPI = "http://127.0.0.1:8091/api"
    static var apiBase: String {
        UserDefaults.standard.string(forKey: "apiBase") ?? defaultAPI
    }
}
