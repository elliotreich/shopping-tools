import SwiftUI
import ShoppingCompassKit

struct ContentView: View {
    var body: some View {
        TabView {
            NavigationStack {
                ListsView()
            }
            .tabItem {
                Label("Lists", systemImage: "list.bullet")
            }

            NavigationStack {
                SearchView()
            }
            .tabItem {
                Label("Search", systemImage: "magnifyingglass")
            }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
        }
    }
}

#Preview {
    ContentView()
}
