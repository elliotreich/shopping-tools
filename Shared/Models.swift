import Foundation

struct SearchProfile: Codable {
    let profileKey: String?
    let keywords: [String]?
    let budget: Double?
    let location: String?
    let radiusMiles: Int?
    let vehicle: String?
    let sizeConstraints: String?
}

struct SearchTemplate: Codable, Identifiable {
    let id: String
    let name: String
    let kind: String
    let profile: SearchProfile
    let sourceAdapters: [String]
    let schedule: String
    let status: String
}

struct DiscoverySearch: Codable, Identifiable {
    let id: String
    let name: String
    let kind: String
    let profile: SearchProfile
    let sourceAdapters: [String]
    let schedule: String
    let status: String
    let lastRunId: String?
    let nextRunAt: String?

    enum CodingKeys: String, CodingKey {
        case id, name, kind, profile, sourceAdapters, schedule, status, lastRunId, nextRunAt
    }
}

struct DiscoveryFinding: Codable, Identifiable {
    let id: String
    let searchId: String
    let kind: String
    let title: String
    let source: String
    let sourceId: String
    let url: String
    let imageURL: String?
    let price: Double?
    let isFree: Bool
    let location: String?
    let description: String?
    let score: Double?
    let scoreReasons: [String]
    let discoveredAt: String?
    let freshness: String?
    let status: String
    let company: String?
    let role: String?
    let salary: String?
    let fitScore: Double?
    let applicationStatus: String?

    enum CodingKeys: String, CodingKey {
        case id, searchId, kind, title, source, sourceId, url
        case imageURL = "imageUrl", price, isFree, location, description, score
        case scoreReasons, discoveredAt, freshness, status, company, role, salary
        case fitScore, applicationStatus
    }
}

struct DiscoveryOperation: Codable, Identifiable {
    let id: String
    let searchId: String
    let startedAt: String
    let finishedAt: String?
    let status: String
    let runtimeSeconds: Double?
    let fetchedCount: Int
    let retainedCount: Int
    let rejectedCount: Int
    let notificationCount: Int
    let sourceErrors: [String]

    enum CodingKeys: String, CodingKey {
        case id, searchId, startedAt, finishedAt, status, runtimeSeconds
        case fetchedCount, retainedCount, rejectedCount, notificationCount, sourceErrors
    }
}

struct SearchesResponse: Codable { let searches: [DiscoverySearch] }
struct FindingsResponse: Codable { let findings: [DiscoveryFinding] }
struct OperationsResponse: Codable { let operations: [DiscoveryOperation] }

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

struct HealthResponse: Codable { let status: String }

enum AppConfig {
    static let defaultAPI = "http://100.121.190.104:8092/api"
    static var apiBase: String { UserDefaults.standard.string(forKey: "apiBase") ?? defaultAPI }
    static var apiToken: String { UserDefaults.standard.string(forKey: "apiToken") ?? "" }
}
