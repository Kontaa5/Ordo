import Foundation

struct HostError: LocalizedError {
    var message: String
    var errorDescription: String? { message }
}
