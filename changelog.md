# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Known Issues]
- None. Please feel free to submit an issue via [GitHub](https://github.com/ryanblenis/MeshCentral-FileDistribution) if you find anything.

## [0.1.0] - 2026-05-07
### Added
- Distribute files to entire device groups (meshes), not just individual devices. The Add dialog gains a "This device only / Entire device group" choice, and a new "Scope" column shows whether each map applies per-device or per-group. Group maps follow group membership: devices added to the group later receive the file on their next agent check-in.
- Mesh-level adds and deletes require admin rights on the device group.
- Validate the server-side source file exists before persisting any map; show a visible error to the admin instead of failing silently.

## [0.0.5] - 2025-12-13
### Fixed
- Compatibility with MeshCentral => 1.1.35

## [0.0.4] - 2022-03-12
### Fixed
- Compatibility with MeshCentral => 0.9.98 (promise requirement removed from MeshCentral, nedb moved to @yetzt/nedb)

## [0.0.3] - 2021-10-07
### Fixed
- Compatibility with MeshCentral > 0.9.7

## [0.0.2] - 2020-03-16
### Fixed
- Check file existence of on server before attempting to send to endpoint. Was causing server crashes if the file was deleted by an admin but a file mapping still existed for a node.

## [0.0.1] - 2020-03-08
### Added
- Released initial version
