// Command fixture is a small linker-metadata fixture used by release build tests.
package main

import (
	"fmt"

	"alslime/internal/buildinfo"
)

func main() {
	fmt.Println(buildinfo.Snapshot(), buildinfo.IsRelease())
}
