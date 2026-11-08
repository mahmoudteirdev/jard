package app.jard.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class TreeTest {
    /** / -> DCIM -> a.jpg(1000), / -> Movies(empty), / -> big.mp4(5000) */
    private fun sample(scope: ScanTree.Scope = ScanTree.Scope.AllFiles): ScanTree {
        val n = arrayListOf(FileNode(0, "/", -1, true, "/"))
        fun add(name: String, parent: Int, dir: Boolean, size: Long = 0): FileNode {
            val x = FileNode(n.size, name, parent, dir, "/$name", apparent = size, onDisk = size, files = if (dir) 0 else 1, modified = 100L + n.size)
            n.add(x)
            n[parent].children.add(x.id)
            return x
        }
        val dcim = add("DCIM", 0, true)
        add("a.jpg", dcim.id, false, 1000)
        add("Movies", 0, true)
        add("big.mp4", 0, false, 5000)
        return ScanTree(n, "/", false, scope).also { it.rollUp() }
    }

    @Test
    fun totalsRollUp() {
        val t = sample()
        assertEquals(6000, t.root.onDisk)
        assertEquals(2, t.root.files)
        assertEquals(2, t.root.dirs)
        assertEquals(1000, t.nodes[1].onDisk)
    }

    @Test
    fun childrenComeAfterParents() {
        for (x in sample().nodes) if (x.parent >= 0) assert(x.parent < x.id)
    }

    @Test
    fun sortLargestAndOldest() {
        val t = sample()
        assertEquals(listOf("big.mp4", "DCIM", "Movies"), t.children(0, FileSort.Largest).map { it.name })
        assertEquals("DCIM", t.children(0, FileSort.Oldest).first { it.modified != 0L || it.isDir }.name)
    }

    @Test
    fun detachShrinksTotalsAndReattachRestores() {
        val t = sample()
        val dcim = 1
        t.detach(dcim)
        assertEquals(5000, t.root.onDisk)
        assertEquals(1, t.root.files)
        assertEquals(1, t.root.dirs)
        assertEquals(listOf(3, 4), t.root.children.toList())
        t.reattach(dcim)
        assertEquals(6000, t.root.onDisk)
        assertEquals(2, t.root.dirs)
    }

    @Test
    fun protectedFolders() {
        val t = sample()
        assertNotNull("the root", protectedReason(t, t.root))
        assertNotNull("standard folder", protectedReason(t, t.nodes[1]))
        assertNull("what is inside it", protectedReason(t, t.nodes[2]))
        assertNull("a plain file", protectedReason(t, t.nodes[4]))
        val link = FileNode(9, "x", 0, false, "/x", isLink = true)
        assertNotNull("links", protectedReason(t, link))
        val q = FileNode(9, QUARANTINE_DIR, 0, true, "/q")
        assertNotNull("the quarantine itself", protectedReason(t, q))
    }

    @Test
    fun aPickedFolderNamedDcimIsNotTheStandardOne() {
        val t = sample(ScanTree.Scope.Picked)
        assertNull(protectedReason(t, t.nodes[1]))
    }

    @Test
    fun kindsAndSizes() {
        assertEquals(FileKind.Video, FileKind.of("Holiday.MP4"))
        assertEquals(FileKind.Image, FileKind.of("a.jpeg"))
        assertEquals(FileKind.Other, FileKind.of("noext"))
        assertEquals("1.23 MB", sizeText(1_234_567))
        assertEquals("999 B", sizeText(999))
        assertEquals("120 GB", sizeText(120_000_000_000))
        assertEquals("1,476,839", countText(1_476_839))
    }
}
