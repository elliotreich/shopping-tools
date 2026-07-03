// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "ShoppingCompass",
  platforms: [
    .macOS(.v14),
  ],
  dependencies: [
    .package(path: "../shared/ShoppingCompassKit"),
  ],
  targets: [
    .executableTarget(
      name: "ShoppingCompassApp",
      dependencies: [
        .product(name: "ShoppingCompassKit", package: "ShoppingCompassKit"),
      ],
      path: "Sources/ShoppingCompassApp"
    ),
  ]
)
