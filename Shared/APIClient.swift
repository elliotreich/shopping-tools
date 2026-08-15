import AppKit
import Foundation
import SwiftUI

enum APIError: LocalizedError {
    case invalidURL
    case unauthorized
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "The API address is invalid."
        case .unauthorized: return "Enter the discovery API token in Settings."
        case .server(let message): return message
        }
    }
}

final class APIClient {
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    private func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
        guard let url = URL(string: AppConfig.apiBase + path) else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue("Bearer \(AppConfig.apiToken)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.server("The API returned no HTTP response.") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.server(String(data: data, encoding: .utf8) ?? "The API returned an error.")
        }
        return data
    }

    func searches() async throws -> [DiscoverySearch] {
        try decoder.decode(SearchesResponse.self, from: await request("/discovery/searches")).searches
    }

    func templates() async throws -> [SearchTemplate] {
        struct Response: Codable { let templates: [SearchTemplate] }
        return try decoder.decode(Response.self, from: await request("/discovery/templates")).templates
    }

    func createSearch(templateID: String, searchID: String, name: String, schedule: String, status: String) async throws {
        _ = try await request("/discovery/searches", method: "POST", body: [
            "action": "create",
            "template_id": templateID,
            "id": searchID,
            "name": name,
            "schedule": schedule,
            "status": status
        ])
    }

    func search(_ query: String, retailers: [String]) async throws -> SearchResponse {
        var components = URLComponents(string: AppConfig.apiBase + "/search")
        components?.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "retailers", value: retailers.joined(separator: ","))
        ]
        guard let path = components?.string?.replacingOccurrences(of: AppConfig.apiBase, with: "") else { throw APIError.invalidURL }
        return try decoder.decode(SearchResponse.self, from: await request(path))
    }

    func findings(searchID: String?, status: String = "new") async throws -> [DiscoveryFinding] {
        var components = URLComponents(string: AppConfig.apiBase + "/discovery/findings")
        components?.queryItems = [
            searchID.map { URLQueryItem(name: "search_id", value: $0) },
            URLQueryItem(name: "status", value: status),
            URLQueryItem(name: "limit", value: "200")
        ].compactMap { $0 }
        guard let path = components?.string?.replacingOccurrences(of: AppConfig.apiBase, with: "") else { throw APIError.invalidURL }
        return try decoder.decode(FindingsResponse.self, from: await request(path)).findings
    }

    func operations(searchID: String?) async throws -> [DiscoveryOperation] {
        var components = URLComponents(string: AppConfig.apiBase + "/discovery/operations")
        components?.queryItems = searchID.map { [URLQueryItem(name: "search_id", value: $0)] }
        guard let path = components?.string?.replacingOccurrences(of: AppConfig.apiBase, with: "") else { throw APIError.invalidURL }
        return try decoder.decode(OperationsResponse.self, from: await request(path)).operations
    }

    func searchAction(_ searchID: String, _ action: String) async throws {
        _ = try await request("/discovery/searches/\(searchID)/actions", method: "POST", body: ["action": action])
    }

    func updateSearch(_ searchID: String, name: String, keywords: String, budget: String, location: String, schedule: String) async throws {
        var body: [String: Any] = ["action": "edit", "name": name, "location": location, "schedule": schedule]
        body["keywords"] = keywords.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        if let value = Double(budget) { body["budget"] = value }
        _ = try await request("/discovery/searches/\(searchID)/actions", method: "POST", body: body)
    }

    func findingAction(_ findingID: String, _ action: String) async throws {
        _ = try await request("/discovery/findings/\(findingID)/actions", method: "POST", body: ["action": action])
    }
}

struct LinkButton: View {
    let title: String
    let url: String

    var body: some View {
        Button(title) {
            guard let link = URL(string: url) else { return }
            NSWorkspace.shared.open(link)
        }
        .buttonStyle(.link)
    }
}

struct RemoteImage: View {
    let url: String
    @State private var image: NSImage?

    var body: some View {
        Group {
            if let image {
                Image(nsImage: image).resizable().scaledToFill()
            } else {
                Color.gray.opacity(0.15)
            }
        }
        .task(id: url) {
            guard let remoteURL = URL(string: url) else { return }
            var request = URLRequest(url: remoteURL)
            request.timeoutInterval = 20
            if !AppConfig.apiToken.isEmpty { request.setValue("Bearer \(AppConfig.apiToken)", forHTTPHeaderField: "Authorization") }
            guard let (data, _) = try? await URLSession.shared.data(for: request), let loaded = NSImage(data: data) else { return }
            image = loaded
        }
    }
}
